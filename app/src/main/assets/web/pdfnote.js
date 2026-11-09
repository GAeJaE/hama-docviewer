/*
 * PDF 필기(노트) 레이어
 * - 페이지마다 캔버스 2장: ink(확정된 획) + live(그리는 중인 획, 입력 받음)
 * - 획 좌표는 페이지 크기 기준 0~1 로 정규화해 저장 → 확대/화면 크기와 무관
 * - 스타일러스가 감지되면 '펜으로만 필기' 모드: 손가락은 스크롤, 펜은 필기
 * - 자동 저장(앱 내부), 필기 포함 PDF 내보내기(pdf-lib, 벡터 선)
 */
(function () {
  'use strict';

  const COLORS = ['#111827', '#dc2626', '#2563eb', '#16a34a', '#f59e0b'];
  const SIZES = { pen: [0.0018, 0.0035, 0.007], hl: [0.012, 0.02, 0.03] }; // 페이지 너비 대비
  const HL_ALPHA = 0.35;

  const N = {
    on: false,
    tool: 'pen',        // pen | hl | eraser
    color: COLORS[0],
    sizeIdx: 1,
    penOnly: false,     // true: 펜으로만 필기, 손가락은 스크롤
    userSetMode: false,
    pages: [],          // { div, ink, live, idx, vpW, vpH, page }
    strokes: {},        // pageIdx → [stroke]
    undo: [], redo: [],
    key: '', buf: null, name: '',
    dirty: false, saveTimer: 0,
    drawing: null,      // 현재 획
  };

  const bar = () => document.getElementById('noteBar');

  // ---------------------------------------------------------------- 연결
  function attach(holders, opts) {
    detach();
    N.key = opts.key; N.buf = opts.buf; N.name = opts.name;
    N.strokes = {}; N.undo = []; N.redo = [];
    try {
      const saved = window.Android && Android.loadNotes ? Android.loadNotes(N.key) : '';
      if (saved) N.strokes = JSON.parse(saved).strokes || {};
    } catch (e) { N.strokes = {}; }
    holders.forEach((div, idx) => {
      const ink = document.createElement('canvas'); ink.className = 'ink-layer';
      const live = document.createElement('canvas'); live.className = 'ink-live';
      div.append(ink, live);
      const vp = div._page.getViewport({ scale: 1 });
      const p = { div, ink, live, idx, page: div._page, vpW: vp.width, vpH: vp.height };
      N.pages.push(p);
      sizeCanvas(p);
      bindPointer(p);
      redraw(p);
    });
    updateBadge();
    return hasNotes();
  }

  function detach() {
    flushSave();
    setOn(false);
    N.pages = [];
  }

  function hasNotes() { return Object.values(N.strokes).some((a) => a && a.length); }

  function sizeCanvas(p) {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = p.div.clientWidth, h = p.div.clientHeight;
    for (const c of [p.ink, p.live]) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
  }

  // ---------------------------------------------------------------- 그리기
  function drawStroke(ctx, s, W, H) {
    const pts = s.p;
    if (!pts || pts.length < 2) return;
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = s.c;
    ctx.globalAlpha = s.a;
    if (s.t === 'hl') ctx.globalCompositeOperation = 'multiply';
    ctx.lineWidth = Math.max(1, s.w * W);
    ctx.beginPath();
    ctx.moveTo(pts[0] * W, pts[1] * H);
    if (pts.length === 2) ctx.lineTo(pts[0] * W + 0.01, pts[1] * H);
    // 중점을 잇는 2차 곡선으로 부드럽게
    for (let i = 2; i < pts.length - 2; i += 2) {
      const x = pts[i] * W, y = pts[i + 1] * H;
      const nx = pts[i + 2] * W, ny = pts[i + 3] * H;
      ctx.quadraticCurveTo(x, y, (x + nx) / 2, (y + ny) / 2);
    }
    if (pts.length >= 4) ctx.lineTo(pts[pts.length - 2] * W, pts[pts.length - 1] * H);
    ctx.stroke();
    ctx.restore();
  }

  function redraw(p) {
    const ctx = p.ink.getContext('2d');
    ctx.clearRect(0, 0, p.ink.width, p.ink.height);
    for (const s of N.strokes[p.idx] || []) drawStroke(ctx, s, p.ink.width, p.ink.height);
  }

  function pos(p, e) {
    const r = p.live.getBoundingClientRect();
    return [
      Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    ];
  }

  function bindPointer(p) {
    const el = p.live;
    // 펜 전용 모드에서 스타일러스가 화면을 스크롤하지 않도록 (손가락 스크롤은 유지)
    el.addEventListener('touchstart', (e) => {
      if (!N.on) return;
      const t = e.touches[0];
      if (t && t.touchType === 'stylus') e.preventDefault();
    }, { passive: false });

    el.addEventListener('pointerdown', (e) => {
      if (!N.on) return;
      if (e.pointerType === 'pen' && !N.userSetMode && !N.penOnly) {
        N.penOnly = true; syncBar();
        toast('펜이 감지되었습니다. 이제 펜으로 필기하고 손가락으로 스크롤합니다.');
      }
      if (N.penOnly && e.pointerType === 'touch') return; // 손가락은 스크롤
      if (e.button > 0 && e.pointerType === 'mouse') return;
      e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* 일부 환경에서 실패해도 그리기는 계속 */ }
      const [x, y] = pos(p, e);
      if (N.tool === 'eraser') {
        N.drawing = { p, pointerId: e.pointerId, erased: [] };
        eraseAt(p, x, y);
        return;
      }
      const hl = N.tool === 'hl';
      N.drawing = {
        p, pointerId: e.pointerId,
        s: { t: hl ? 'hl' : 'pen', c: N.color, a: hl ? HL_ALPHA : 1, w: SIZES[hl ? 'hl' : 'pen'][N.sizeIdx], p: [r4(x), r4(y)] },
      };
    });

    el.addEventListener('pointermove', (e) => {
      const d = N.drawing;
      if (!d || d.p !== p || d.pointerId !== e.pointerId) return;
      e.preventDefault();
      const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of events.length ? events : [e]) {
        const [x, y] = pos(p, ev);
        if (d.erased) { eraseAt(p, x, y); continue; }
        const pts = d.s.p;
        const lx = pts[pts.length - 2], ly = pts[pts.length - 1];
        if (Math.abs(x - lx) + Math.abs(y - ly) < 0.0008) continue; // 너무 촘촘한 점 생략
        pts.push(r4(x), r4(y));
      }
      if (d.s) {
        const ctx = p.live.getContext('2d');
        ctx.clearRect(0, 0, p.live.width, p.live.height);
        drawStroke(ctx, d.s, p.live.width, p.live.height);
      }
    });

    const end = (e) => {
      const d = N.drawing;
      if (!d || d.p !== p || d.pointerId !== e.pointerId) return;
      N.drawing = null;
      p.live.getContext('2d').clearRect(0, 0, p.live.width, p.live.height);
      if (d.erased) {
        if (d.erased.length) pushHistory({ type: 'erase', page: p.idx, items: d.erased });
        return;
      }
      (N.strokes[p.idx] = N.strokes[p.idx] || []).push(d.s);
      drawStroke(p.ink.getContext('2d'), d.s, p.ink.width, p.ink.height);
      pushHistory({ type: 'add', page: p.idx, stroke: d.s });
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', (e) => { // 두 손가락 확대 등으로 취소되면 그리던 획 버림
      if (N.drawing && N.drawing.p === p) {
        N.drawing = null;
        p.live.getContext('2d').clearRect(0, 0, p.live.width, p.live.height);
      }
    });
  }

  /** 다른 손가락이 닿으면(확대/이동) 그리던 획 취소 */
  function cancelDrawing() {
    const d = N.drawing;
    if (!d) return;
    N.drawing = null;
    d.p.live.getContext('2d').clearRect(0, 0, d.p.live.width, d.p.live.height);
    if (d.erased && d.erased.length) pushHistory({ type: 'erase', page: d.p.idx, items: d.erased });
  }

  function eraseAt(p, x, y) {
    const list = N.strokes[p.idx];
    if (!list || !list.length) return;
    const r = 14 / p.live.getBoundingClientRect().width; // 지우개 반경 ≈ 화면 14px
    const ry = r * p.vpW / p.vpH;
    let changed = false;
    for (let i = list.length - 1; i >= 0; i--) {
      const s = list[i];
      const tol = s.w / 2;
      for (let j = 0; j < s.p.length; j += 2) {
        if (Math.abs(s.p[j] - x) < r + tol && Math.abs(s.p[j + 1] - y) < ry + tol * p.vpW / p.vpH) {
          N.drawing.erased.push({ index: i, stroke: s });
          list.splice(i, 1);
          changed = true;
          break;
        }
      }
    }
    if (changed) redraw(p);
  }

  const r4 = (v) => Math.round(v * 10000) / 10000;

  // ---------------------------------------------------------------- 되돌리기
  function pushHistory(act) {
    N.undo.push(act);
    if (N.undo.length > 300) N.undo.shift();
    N.redo = [];
    changed();
  }

  function apply(act, reverse) {
    const list = (N.strokes[act.page] = N.strokes[act.page] || []);
    if (act.type === 'add') {
      if (reverse) { const i = list.lastIndexOf(act.stroke); if (i >= 0) list.splice(i, 1); }
      else list.push(act.stroke);
    } else if (act.type === 'erase') {
      if (reverse) [...act.items].reverse().forEach((it) => list.splice(Math.min(it.index, list.length), 0, it.stroke));
      else act.items.forEach((it) => { const i = list.indexOf(it.stroke); if (i >= 0) list.splice(i, 1); });
    } else if (act.type === 'clear') {
      if (reverse) N.strokes = act.before;
      else N.strokes = {};
    }
    const targets = act.type === 'clear' ? N.pages : N.pages.filter((p) => p.idx === act.page);
    targets.forEach(redraw);
  }

  function undo() { const a = N.undo.pop(); if (!a) return; apply(a, true); N.redo.push(a); changed(); }
  function redo() { const a = N.redo.pop(); if (!a) return; apply(a, false); N.undo.push(a); changed(); }
  function clearAll() {
    if (!hasNotes()) return;
    if (!confirm('이 문서의 필기를 모두 지울까요?')) return;
    const act = { type: 'clear', before: N.strokes };
    N.strokes = {};
    N.pages.forEach(redraw);
    pushHistory(act);
  }

  // ---------------------------------------------------------------- 저장
  function changed() {
    N.dirty = true;
    clearTimeout(N.saveTimer);
    N.saveTimer = setTimeout(flushSave, 800);
    syncBar();
    updateBadge();
  }

  function flushSave() {
    clearTimeout(N.saveTimer);
    if (!N.dirty || !N.key) return;
    N.dirty = false;
    // 빈 페이지 정리
    for (const k of Object.keys(N.strokes)) if (!N.strokes[k] || !N.strokes[k].length) delete N.strokes[k];
    try { window.Android && Android.saveNotes && Android.saveNotes(N.key, JSON.stringify({ v: 1, name: N.name, strokes: N.strokes })); } catch (e) { /* ignore */ }
  }

  /** 필기를 벡터 선으로 넣은 새 PDF 바이트 생성 */
  async function buildPdf() {
    const { PDFDocument, rgb, LineCapStyle } = PDFLib;
    const doc = await PDFDocument.load(N.buf, { ignoreEncryption: true });
    const pdfPages = doc.getPages();
    for (const p of N.pages) {
      const list = N.strokes[p.idx];
      if (!list || !list.length || !pdfPages[p.idx]) continue;
      const vp = p.page.getViewport({ scale: 1 });
      const page = pdfPages[p.idx];
      for (const s of list) {
        const pts = [];
        for (let i = 0; i < s.p.length; i += 2) pts.push(vp.convertToPdfPoint(s.p[i] * vp.width, s.p[i + 1] * vp.height));
        if (pts.length === 1) pts.push([pts[0][0] + 0.05, pts[0][1]]);
        // drawSvgPath 는 y 를 뒤집으므로 -y 로 넘김
        const d = pts.map((q, i) => `${i ? 'L' : 'M'}${q[0].toFixed(2)} ${(-q[1]).toFixed(2)}`).join(' ');
        const c = parseInt(s.c.slice(1), 16);
        page.drawSvgPath(d, {
          x: 0, y: 0,
          borderColor: rgb(((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255),
          borderWidth: s.w * vp.width,
          borderOpacity: s.a,
          borderLineCap: LineCapStyle.Round,
        });
      }
    }
    return doc.save();
  }

  async function exportPdf(mode) {
    const notes = hasNotes();
    if (!notes && mode !== 'print') { toast('필기한 내용이 없습니다.'); return; }
    if (!window.Android || !Android.exportBegin) { toast('이 환경에서는 저장할 수 없습니다.'); return; }
    if (notes) toast('필기를 넣은 PDF를 만드는 중…');
    try {
      const bytes = notes ? await buildPdf() : new Uint8Array(N.buf);
      const base = (N.name || '문서').replace(/\.pdf$/i, '');
      Android.exportBegin(notes ? `${base}_필기.pdf` : `${base}.pdf`);
      const CHUNK = 768 * 1024; // 3의 배수 → base64 조각이 깨지지 않음
      for (let i = 0; i < bytes.length; i += CHUNK) {
        let bin = '';
        const part = bytes.subarray(i, i + CHUNK);
        for (let j = 0; j < part.length; j += 8192) bin += String.fromCharCode.apply(null, part.subarray(j, j + 8192));
        Android.exportChunk(btoa(bin));
      }
      Android.exportFinish(mode);
    } catch (e) {
      console.error(e);
      toast('PDF 저장 실패: ' + (e.message || e));
    }
  }

  // ---------------------------------------------------------------- 도구 막대
  function setOn(on) {
    N.on = !!on && N.pages.length > 0;
    document.body.classList.toggle('note-on', N.on);
    document.body.classList.toggle('pen-only', N.on && N.penOnly);
    const b = bar(); if (b) b.hidden = !N.on;
    const btn = document.getElementById('btnPen'); if (btn) btn.classList.toggle('active', N.on);
    if (!N.on) { cancelDrawing(); flushSave(); }
    syncBar();
  }

  function syncBar() {
    const b = bar(); if (!b) return;
    b.querySelectorAll('[data-tool]').forEach((x) => x.classList.toggle('on', x.dataset.tool === N.tool));
    b.querySelectorAll('[data-color]').forEach((x) => x.classList.toggle('on', x.dataset.color === N.color));
    b.querySelectorAll('[data-size]').forEach((x) => x.classList.toggle('on', +x.dataset.size === N.sizeIdx));
    const f = b.querySelector('[data-note="finger"]');
    if (f) { f.classList.toggle('on', !N.penOnly); f.title = N.penOnly ? '펜으로만 필기 중 (눌러서 손가락 필기)' : '손가락으로도 필기 중'; }
    const u = b.querySelector('[data-note="undo"]'); if (u) u.disabled = !N.undo.length;
    const r = b.querySelector('[data-note="redo"]'); if (r) r.disabled = !N.redo.length;
    document.body.classList.toggle('pen-only', N.on && N.penOnly);
  }

  function updateBadge() {
    const btn = document.getElementById('btnPen');
    if (btn) btn.classList.toggle('has-notes', hasNotes());
  }

  function toast(m) { try { Android.toast(m); } catch (e) { console.log(m); } }

  function initBar() {
    const b = bar();
    if (!b || b._init) return;
    b._init = true;
    // 색상·굵기 버튼 생성
    const colors = b.querySelector('.nb-colors');
    COLORS.forEach((c) => {
      const x = document.createElement('button');
      x.className = 'nb-color'; x.dataset.color = c; x.style.setProperty('--c', c); x.setAttribute('aria-label', '색상');
      colors.appendChild(x);
    });
    b.addEventListener('click', (e) => {
      const t = e.target.closest('button');
      if (!t) return;
      if (t.dataset.tool) N.tool = t.dataset.tool;
      else if (t.dataset.color) { N.color = t.dataset.color; if (N.tool === 'eraser') N.tool = 'pen'; }
      else if (t.dataset.size) N.sizeIdx = +t.dataset.size;
      else if (t.dataset.note === 'undo') undo();
      else if (t.dataset.note === 'redo') redo();
      else if (t.dataset.note === 'clear') clearAll();
      else if (t.dataset.note === 'finger') { N.penOnly = !N.penOnly; N.userSetMode = true; toast(N.penOnly ? '펜으로만 필기합니다. 손가락으로는 스크롤하세요.' : '손가락으로도 필기합니다. 두 손가락으로 스크롤하세요.'); }
      else if (t.dataset.note === 'save') exportPdf('save');
      else if (t.dataset.note === 'share') exportPdf('share');
      else if (t.dataset.note === 'close') setOn(false);
      syncBar();
    });
  }

  document.addEventListener('DOMContentLoaded', initBar);
  if (document.readyState !== 'loading') initBar();

  window.PdfNotes = {
    attach, detach, setOn,
    toggle: () => setOn(!N.on),
    isOn: () => N.on,
    hasNotes,
    cancelDrawing,
    exportPdf,
    flush: flushSave,
    buildPdf,
    resize: () => N.pages.forEach((p) => { sizeCanvas(p); redraw(p); }),
    _state: N,
  };
})();
