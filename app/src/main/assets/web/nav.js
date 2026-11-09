/*
 * 문서 탐색 도우미
 *  - 문서 안 검색 (화면에 그린 모든 문서 + PDF 글자 레이어)
 *  - 쪽 표시("3 / 14")와 쪽 번호로 이동
 *  - 마지막으로 보던 위치 기억 / 이어 보기
 */
(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const viewer = () => $('#viewer');
  const docEl = () => $('#doc');

  const PAGE_SEL = {
    pdf: '.pdf-page', hwpx: '.hwpx-page', hwp: '.hwpjs-page', docx: '.docx-wrapper > section',
    pptx: '.pptx-preview-slide-wrapper', ppt: '.slide-card', odp: '.slide-card', epub: '.md-page',
  };
  const NO_SEARCH = new Set(['image', 'video', 'audio', 'html']);
  const POS_KEY = 'pos.v1';

  const S = {
    kind: null, key: null, pages: [], cur: 0,
    pdf: null,                  // { numPages, pageText(i) → Promise<string>, textLayer(i) → Promise<Element> }
    search: { q: '', hits: [], idx: -1, token: 0, marks: [], pdfPage: -1 },
    scrollRaf: 0, saveTimer: 0,
  };

  // ================================================================ 공통
  function relTop(el) { return el.getBoundingClientRect().top - viewer().getBoundingClientRect().top; }

  function scrollToEl(el, ratio) {
    const v = viewer();
    const r = el.getBoundingClientRect(), vr = v.getBoundingClientRect();
    v.scrollTop += r.top - vr.top - v.clientHeight * (ratio == null ? 0.33 : ratio);
    if (r.left < vr.left || r.right > vr.right) v.scrollLeft += r.left - vr.left - v.clientWidth / 2 + r.width / 2;
  }

  function toast(m) { try { Android.toast(m); } catch (e) { console.log(m); } }

  // ================================================================ 쪽 표시 / 이동
  function collectPages() {
    const sel = PAGE_SEL[S.kind];
    S.pages = sel ? [...docEl().querySelectorAll(sel)] : [];
    const ind = $('#pageInd');
    ind.hidden = S.pages.length < 2;
    updateCurrent();
  }

  function currentPage() {
    const pages = S.pages;
    if (!pages.length) return 0;
    const line = viewer().clientHeight * 0.3;
    // 이진 탐색: 위쪽이 기준선보다 위에 있는 마지막 쪽
    let lo = 0, hi = pages.length - 1, ans = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (relTop(pages[mid]) <= line) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans;
  }

  function updateCurrent() {
    if (!S.pages.length) return;
    S.cur = currentPage();
    $('#pageIndText').textContent = `${S.cur + 1} / ${S.pages.length}`;
  }

  function goPage(n) {
    if (!S.pages.length) return;
    n = Math.max(1, Math.min(S.pages.length, n | 0));
    scrollToEl(S.pages[n - 1], 0);
    viewer().scrollTop += -8;
    updateCurrent();
  }

  function openJump() {
    if (!S.pages.length) return;
    const box = $('#pageJump');
    const inp = $('#pageJumpInput');
    inp.max = S.pages.length;
    inp.value = S.cur + 1;
    $('#pageJumpTotal').textContent = `/ ${S.pages.length}`;
    box.hidden = false;
    setTimeout(() => { inp.focus(); inp.select(); }, 50);
  }
  function closeJump() { $('#pageJump').hidden = true; }

  // ================================================================ 위치 기억
  function loadPos() { try { return JSON.parse(localStorage.getItem(POS_KEY) || '{}'); } catch (e) { return {}; } }

  function savePos() {
    clearTimeout(S.saveTimer);
    if (!S.key) return;
    const v = viewer();
    const rec = { t: Date.now() };
    if (S.pages.length) {
      const p = currentPage();
      const el = S.pages[p];
      rec.p = p;
      rec.f = Math.max(0, Math.min(1, -relTop(el) / Math.max(1, el.getBoundingClientRect().height)));
    } else {
      rec.y = v.scrollHeight > v.clientHeight ? v.scrollTop / (v.scrollHeight - v.clientHeight) : 0;
    }
    const tab = $('#sheetTabs .on');
    if (tab) rec.s = [...tab.parentNode.children].indexOf(tab);
    const all = loadPos();
    all[S.key] = rec;
    const keys = Object.keys(all);
    if (keys.length > 200) keys.sort((a, b) => all[a].t - all[b].t).slice(0, keys.length - 200).forEach((k) => delete all[k]);
    try { localStorage.setItem(POS_KEY, JSON.stringify(all)); } catch (e) { /* ignore */ }
  }

  function restorePos() {
    const rec = S.key && loadPos()[S.key];
    if (!rec) return;
    if (rec.s > 0) { const tab = $('#sheetTabs').children[rec.s]; if (tab) tab.click(); }
    const v = viewer();
    if (S.pages.length && rec.p != null && S.pages[rec.p]) {
      const el = S.pages[rec.p];
      v.scrollTop += relTop(el) + el.getBoundingClientRect().height * (rec.f || 0);
      if (rec.p > 0) toast(`마지막으로 보던 ${rec.p + 1}쪽부터 이어서 보여 드립니다.`);
    } else if (rec.y > 0.02) {
      v.scrollTop = rec.y * (v.scrollHeight - v.clientHeight);
      toast('마지막으로 보던 위치부터 이어서 보여 드립니다.');
    }
    updateCurrent();
  }

  // ================================================================ 검색
  /** root 아래 글자들을 이어 붙여 q 를 찾고, 일치 부분을 <mark> 로 감싼다. 일치마다 mark 배열 반환 */
  function highlightIn(root, q) {
    const ql = q.toLowerCase();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentNode.closest('script,style,.notice,mark.hit') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    const nodes = [];
    let text = '';
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      nodes.push({ n, start: text.length });
      text += n.nodeValue;
    }
    const lower = text.toLowerCase();
    const ranges = [];
    for (let i = lower.indexOf(ql); i >= 0 && ranges.length < 3000; i = lower.indexOf(ql, i + ql.length)) ranges.push([i, i + ql.length]);
    if (!ranges.length) return [];
    // 일치 구간을 텍스트 노드 조각으로 나눔
    const pieces = [];
    let ni = 0;
    ranges.forEach(([a, b], mi) => {
      while (ni < nodes.length - 1 && nodes[ni + 1].start <= a) ni++;
      for (let k = ni; k < nodes.length && nodes[k].start < b; k++) {
        const { n, start } = nodes[k];
        const s = Math.max(a, start) - start, e = Math.min(b, start + n.nodeValue.length) - start;
        if (e > s) pieces.push({ n, s, e, mi });
      }
    });
    // 같은 노드 안에서는 뒤쪽 조각부터 감싸야 앞쪽 위치가 유지됨
    const byNode = new Map();
    pieces.forEach((p) => { if (!byNode.has(p.n)) byNode.set(p.n, []); byNode.get(p.n).push(p); });
    const marks = ranges.map(() => []);
    byNode.forEach((list, node) => {
      list.sort((x, y) => y.s - x.s).forEach((p) => {
        const r = document.createRange();
        r.setStart(node, p.s); r.setEnd(node, p.e);
        const m = document.createElement('mark');
        m.className = 'hit';
        try { r.surroundContents(m); marks[p.mi].unshift(m); } catch (e) { /* ignore */ }
      });
    });
    return marks.filter((m) => m.length);
  }

  function clearMarks(root) {
    (root || docEl()).querySelectorAll('mark.hit').forEach((m) => {
      const parent = m.parentNode;
      parent.replaceChild(document.createTextNode(m.textContent), m);
      parent.normalize();
    });
  }

  function countIn(text, q) {
    const l = text.toLowerCase(), ql = q.toLowerCase();
    let c = 0;
    for (let i = l.indexOf(ql); i >= 0; i = l.indexOf(ql, i + ql.length)) c++;
    return c;
  }

  function setCount() {
    const s = S.search;
    const el = $('#searchCount');
    if (!s.q) el.textContent = '';
    else if (s.busy) el.textContent = s.hits.length ? `${s.idx + 1}/${s.hits.length}+` : '찾는 중…';
    else el.textContent = s.hits.length ? `${s.idx + 1}/${s.hits.length}` : '없음';
    $('#searchPrev').disabled = $('#searchNext').disabled = !s.hits.length;
  }

  async function runSearch(q) {
    const s = S.search;
    const token = ++s.token;
    clearMarks();
    s.q = q; s.hits = []; s.idx = -1; s.pdfPage = -1; s.busy = false;
    if (!q) { setCount(); return; }

    if (S.pdf) {
      // PDF: 쪽마다 글자를 꺼내 개수만 세고, 해당 쪽으로 갈 때 글자 레이어에 표시
      s.busy = true; setCount();
      for (let i = 0; i < S.pdf.numPages; i++) {
        const text = await S.pdf.pageText(i);
        if (token !== s.token) return;
        const c = countIn(text, q);
        for (let k = 0; k < c; k++) s.hits.push({ page: i, k });
        if (s.idx < 0 && s.hits.length) await go(0);
        else setCount();
      }
      s.busy = false; setCount();
      if (!s.hits.length) toast(`'${q}'을(를) 찾지 못했습니다.`);
      return;
    }

    const marks = highlightIn(docEl(), q);
    s.hits = marks.map((m) => ({ marks: m }));
    if (s.hits.length) await go(0);
    else { setCount(); toast(`'${q}'을(를) 찾지 못했습니다.`); }
  }

  async function go(idx) {
    const s = S.search;
    if (!s.hits.length) return;
    idx = (idx + s.hits.length) % s.hits.length;
    s.idx = idx;
    const hit = s.hits[idx];
    let marks;
    if (S.pdf) {
      if (s.pdfPage !== hit.page) {
        if (s.pdfPage >= 0) clearMarks(await S.pdf.textLayer(s.pdfPage));
        const layer = await S.pdf.textLayer(hit.page);
        s.pageMarks = highlightIn(layer, s.q);
        s.pdfPage = hit.page;
      }
      marks = s.pageMarks[hit.k] || [];
      if (!marks.length) scrollToEl(S.pdf.holder(hit.page), 0.1);
    } else {
      marks = hit.marks;
    }
    docEl().querySelectorAll('mark.hit.cur').forEach((m) => m.classList.remove('cur'));
    marks.forEach((m) => m.classList.add('cur'));
    if (marks[0]) scrollToEl(marks[0]);
    setCount();
  }

  function openSearch() {
    closeJump();
    const bar = $('#searchBar');
    bar.hidden = false;
    const inp = $('#searchInput');
    setTimeout(() => { inp.focus(); inp.select(); }, 50);
  }

  function closeSearch() {
    $('#searchBar').hidden = true;
    S.search.token++;
    clearMarks();
    S.search.q = ''; S.search.hits = []; S.search.pdfPage = -1;
    $('#searchInput').blur();
  }

  // ================================================================ 연결
  function reset() {
    savePos();
    if (!$('#searchBar').hidden) closeSearch();
    closeJump();
    S.kind = null; S.key = null; S.pages = []; S.pdf = null;
    $('#pageInd').hidden = true;
    $('#btnSearch').hidden = true;
  }

  /** 문서를 다 그린 뒤 호출 */
  function ready(opts) {
    S.kind = opts.kind; S.key = opts.key || null;
    $('#btnSearch').hidden = NO_SEARCH.has(S.kind);
    collectPages();
    if (opts.restore !== false) restorePos();
  }

  function init() {
    const v = viewer();
    v.addEventListener('scroll', () => {
      if (S.scrollRaf) return;
      S.scrollRaf = requestAnimationFrame(() => { S.scrollRaf = 0; updateCurrent(); });
      clearTimeout(S.saveTimer);
      S.saveTimer = setTimeout(savePos, 700);
    }, { passive: true });
    document.addEventListener('visibilitychange', () => { if (document.hidden) savePos(); });

    $('#btnSearch').onclick = () => { if ($('#searchBar').hidden) openSearch(); else closeSearch(); };
    const inp = $('#searchInput');
    let t = 0;
    inp.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => runSearch(inp.value.trim()), 350); });
    inp.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const q = inp.value.trim();
      if (q !== S.search.q) { clearTimeout(t); runSearch(q); } else go(S.search.idx + (e.shiftKey ? -1 : 1));
    });
    $('#searchNext').onclick = () => go(S.search.idx + 1);
    $('#searchPrev').onclick = () => go(S.search.idx - 1);
    $('#searchClose').onclick = closeSearch;

    $('#pageInd').onclick = openJump;
    const jump = () => { goPage(+$('#pageJumpInput').value); closeJump(); };
    $('#pageJumpGo').onclick = jump;
    $('#pageJumpInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); jump(); } });
    $('#pageJumpFirst').onclick = () => { goPage(1); closeJump(); };
    $('#pageJumpLast').onclick = () => { goPage(S.pages.length); closeJump(); };
    $('#pageJump').addEventListener('click', (e) => { if (e.target.id === 'pageJump') closeJump(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  window.DocNav = {
    reset, ready, savePos,
    setPdf: (api) => { S.pdf = api; },
    /** 엑셀 시트를 바꾸는 등 내용이 새로 그려졌을 때 */
    refresh: () => { collectPages(); if (!$('#searchBar').hidden && S.search.q) runSearch(S.search.q); },
    openSearch, closeSearch,
    /** 뒤로 가기 처리: 열린 창이 있으면 닫고 true */
    back: () => {
      if (!$('#pageJump').hidden) { closeJump(); return true; }
      if (!$('#searchBar').hidden) { closeSearch(); return true; }
      return false;
    },
    _state: S,
  };
})();
