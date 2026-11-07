/*
 * HWPX(한글 개방형 문서, OWPML) 렌더러
 * Contents/header.xml 의 글자/문단/테두리 모양과 section*.xml 본문을 HTML 로 그린다.
 * 문단의 lineseg vertpos 값을 이용해 한글에서 저장한 쪽 나눔을 그대로 재현한다.
 */
(function () {
  'use strict';

  const px = (hu) => (Number(hu) || 0) / 75; // HWPUNIT(1/7200 inch) → CSS px(1/96 inch)
  const kids = (el, name) => (el ? Array.from(el.children).filter((c) => c.localName === name) : []);
  const kid = (el, name) => { if (el) for (const c of el.children) if (c.localName === name) return c; return null; };
  const deep = (el, name) => (el ? el.getElementsByTagNameNS('*', name)[0] || null : null);
  const attr = (el, name, d) => { const v = el && el.getAttribute(name); return v == null ? d : v; };
  const mk = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };

  /** hp:switch 가 있으면 hp:default 쪽을 우선 사용 */
  function pick(el, name) {
    const direct = kid(el, name);
    if (direct) return direct;
    const sw = kid(el, 'switch');
    if (sw) {
      const def = kid(sw, 'default');
      const d = kid(def, name);
      if (d) return d;
      for (const cs of kids(sw, 'case')) { const c = kid(cs, name); if (c) return c; }
    }
    return deep(el, name);
  }

  function marginVal(m, name) {
    if (!m) return 0;
    if (m.hasAttribute(name)) return +m.getAttribute(name);
    const c = kid(m, name);
    return c ? +attr(c, 'value', 0) : 0;
  }

  function color(c) {
    if (!c || c === 'none') return null;
    if (/^#[0-9a-f]{8}$/i.test(c)) return '#' + c.slice(3); // #AARRGGBB
    return c;
  }

  function fontStack(face) {
    if (!face) return null;
    const sans = /고딕|돋움|굴림|Gothic|Dotum|Gulim|Arial|Helvetica|Sans|맑은|나눔스퀘어|Pretendard/i.test(face);
    return `"${face.replace(/"/g, '')}", ${sans ? '"Noto Sans CJK KR", sans-serif' : '"Noto Serif CJK KR", serif'}`;
  }

  function lineStyle(type) {
    switch ((type || '').toUpperCase()) {
      case 'NONE': return null;
      case 'DASH': case 'LONG_DASH': case 'DASH_DOT': case 'DASH_DOT_DOT': return 'dashed';
      case 'DOT': case 'CIRCLE': return 'dotted';
      case 'DOUBLE_SLIM': case 'SLIM_THICK': case 'THICK_SLIM': case 'SLIM_THICK_SLIM': return 'double';
      default: return 'solid';
    }
  }

  function borderCss(b) {
    if (!b) return 'none';
    const st = lineStyle(attr(b, 'type'));
    if (!st) return 'none';
    let w = parseFloat(attr(b, 'width', '0.12')) || 0.12; // mm
    w = Math.max(1, Math.round(w * 3.78 * 10) / 10);
    if (st === 'double') w = Math.max(3, w);
    return `${w}px ${st} ${color(attr(b, 'color', '#000000')) || '#000'}`;
  }

  // ------------------------------------------------------------ header.xml
  function buildStyles(header) {
    const S = { fonts: {}, chars: {}, paras: {}, borders: {} };
    if (!header) return S;

    for (const ff of header.getElementsByTagNameNS('*', 'fontface')) {
      const lang = (attr(ff, 'lang', '') || '').toUpperCase();
      if (lang !== 'HANGUL') continue;
      for (const f of kids(ff, 'font')) S.fonts[attr(f, 'id')] = attr(f, 'face');
    }

    for (const cp of header.getElementsByTagNameNS('*', 'charPr')) {
      const css = [];
      const h = +attr(cp, 'height', 1000);
      css.push(`font-size:${h / 100}pt`);
      const tc = color(attr(cp, 'textColor'));
      if (tc && tc.toLowerCase() !== '#000000') css.push(`color:${tc}`);
      const sc = color(attr(cp, 'shadeColor'));
      if (sc && sc.toLowerCase() !== '#ffffff') css.push(`background:${sc}`);
      const fr = kid(cp, 'fontRef');
      if (fr) { const fs = fontStack(S.fonts[attr(fr, 'hangul')]); if (fs) css.push(`font-family:${fs}`); }
      if (kid(cp, 'bold')) css.push('font-weight:bold');
      if (kid(cp, 'italic')) css.push('font-style:italic');
      const deco = [];
      const ul = kid(cp, 'underline');
      if (ul && (attr(ul, 'type', 'NONE') || 'NONE').toUpperCase() !== 'NONE') deco.push('underline');
      const so = kid(cp, 'strikeout');
      if (so && !/NONE/i.test(attr(so, 'shape', 'NONE'))) deco.push('line-through');
      if (deco.length) css.push(`text-decoration:${deco.join(' ')}`);
      if (kid(cp, 'supscript')) css.push('vertical-align:super;font-size:' + (h / 160) + 'pt');
      if (kid(cp, 'subscript')) css.push('vertical-align:sub;font-size:' + (h / 160) + 'pt');
      const sp = kid(cp, 'spacing');
      if (sp) { const v = +attr(sp, 'hangul', 0); if (v) css.push(`letter-spacing:${v / 100}em`); }
      const ra = kid(cp, 'ratio');
      if (ra) { const v = +attr(ra, 'hangul', 100); if (v && v !== 100) css.push(`display:inline-block;transform:scaleX(${v / 100});transform-origin:left`); }
      S.chars[attr(cp, 'id')] = css.join(';');
    }

    for (const pp of header.getElementsByTagNameNS('*', 'paraPr')) {
      const css = [];
      const al = kid(pp, 'align') || deep(pp, 'align');
      const h = (attr(al, 'horizontal', 'JUSTIFY') || '').toUpperCase();
      css.push('text-align:' + ({ LEFT: 'left', RIGHT: 'right', CENTER: 'center', DISTRIBUTE: 'justify', DISTRIBUTE_SPACE: 'justify' }[h] || 'justify'));
      const m = pick(pp, 'margin');
      const left = marginVal(m, 'left'), right = marginVal(m, 'right');
      const indent = marginVal(m, 'intent') || marginVal(m, 'indent');
      const prev = marginVal(m, 'prev'), next = marginVal(m, 'next');
      if (indent < 0) css.push(`padding-left:${px(left - indent)}px;text-indent:${px(indent)}px`);
      else css.push(`padding-left:${px(left)}px;text-indent:${px(indent)}px`);
      if (right) css.push(`padding-right:${px(right)}px`);
      if (prev) css.push(`margin-top:${px(prev)}px`);
      if (next) css.push(`margin-bottom:${px(next)}px`);
      const ls = pick(pp, 'lineSpacing');
      if (ls) {
        const t = (attr(ls, 'type', 'PERCENT') || '').toUpperCase();
        const v = +attr(ls, 'value', 160);
        if (t === 'PERCENT') css.push(`line-height:${Math.max(v, 50) / 100}`);
        else if (t === 'FIXED' || t === 'AT_LEAST') css.push(`line-height:${px(v)}px`);
      }
      S.paras[attr(pp, 'id')] = css.join(';');
    }

    for (const bf of header.getElementsByTagNameNS('*', 'borderFill')) {
      const css = [
        `border-left:${borderCss(kid(bf, 'leftBorder'))}`,
        `border-right:${borderCss(kid(bf, 'rightBorder'))}`,
        `border-top:${borderCss(kid(bf, 'topBorder'))}`,
        `border-bottom:${borderCss(kid(bf, 'bottomBorder'))}`,
      ];
      const wb = deep(bf, 'winBrush');
      if (wb) { const fc = color(attr(wb, 'faceColor')); if (fc && fc.toLowerCase() !== '#ffffff') css.push(`background:${fc}`); }
      S.borders[attr(bf, 'id')] = css.join(';');
    }
    return S;
  }

  // ------------------------------------------------------------ 본문
  class Renderer {
    constructor(styles, images) {
      this.S = styles;
      this.images = images;
    }

    paragraphs(container, parent) {
      for (const p of kids(parent, 'p')) container.appendChild(this.para(p));
    }

    para(p) {
      const div = mk('div', 'p');
      const ps = this.S.paras[attr(p, 'paraPrIDRef')];
      if (ps) div.style.cssText = ps;
      let hasContent = false;
      for (const run of kids(p, 'run')) {
        const cs = this.S.chars[attr(run, 'charPrIDRef')] || '';
        for (const n of run.children) {
          const el = this.inline(n, cs);
          if (el) { div.appendChild(el); hasContent = true; }
        }
      }
      if (!hasContent) div.appendChild(document.createTextNode(' '));
      return div;
    }

    inline(n, cs) {
      switch (n.localName) {
        case 't': return this.text(n, cs);
        case 'tbl': return this.table(n);
        case 'pic': return this.pic(n);
        case 'equation': {
          const s = mk('span'); s.style.cssText = cs + ';font-style:italic';
          s.textContent = (deep(n, 'script') || {}).textContent || '';
          return s;
        }
        case 'rect': case 'ellipse': case 'polygon': case 'curve': case 'arc': case 'container':
          return this.shape(n);
        default: return null; // secPr, ctrl(머리말/꼬리말/각주), 필드 등
      }
    }

    text(t, cs) {
      const span = mk('span');
      if (cs) span.style.cssText = cs;
      t.childNodes.forEach((c) => {
        if (c.nodeType === 3) span.appendChild(document.createTextNode(c.nodeValue));
        else if (c.nodeType === 1) {
          switch (c.localName) {
            case 'lineBreak': span.appendChild(mk('br')); break;
            case 'tab': span.appendChild(mk('span', 'tab')); break;
            case 'nbSpace': case 'fwSpace': span.appendChild(document.createTextNode(' ')); break;
            case 'hyphen': span.appendChild(document.createTextNode('-')); break;
            default: if (c.textContent) span.appendChild(document.createTextNode(c.textContent));
          }
        }
      });
      return span;
    }

    table(tbl) {
      const wrap = mk('div');
      wrap.style.cssText = 'text-indent:0;overflow-x:auto';
      const pos = kid(tbl, 'pos');
      const inlineTbl = attr(pos, 'treatAsChar', '0') === '1';
      if (inlineTbl) wrap.style.display = 'inline-block';
      const t = mk('table', 'hwpx-tbl');
      const sz = kid(tbl, 'sz');
      if (sz) t.style.width = px(attr(sz, 'width')) + 'px';
      const bf = this.S.borders[attr(tbl, 'borderFillIDRef')];
      if (bf) t.style.cssText += ';' + bf;
      const hAlign = (attr(pos, 'horzAlign', '') || '').toUpperCase();
      if (!inlineTbl && hAlign === 'CENTER') t.style.margin = '2px auto';
      if (!inlineTbl && hAlign === 'RIGHT') t.style.marginLeft = 'auto';
      const tbody = mk('tbody');
      for (const tr of kids(tbl, 'tr')) {
        const row = mk('tr');
        for (const tc of kids(tr, 'tc')) {
          const td = mk('td');
          const span = kid(tc, 'cellSpan');
          if (span) {
            const cs = +attr(span, 'colSpan', 1), rs = +attr(span, 'rowSpan', 1);
            if (cs > 1) td.colSpan = cs;
            if (rs > 1) td.rowSpan = rs;
          }
          let css = this.S.borders[attr(tc, 'borderFillIDRef')] || '';
          const csz = kid(tc, 'cellSz');
          if (csz) css += `;width:${px(attr(csz, 'width'))}px;height:${px(attr(csz, 'height'))}px`;
          const cm = kid(tc, 'cellMargin');
          if (cm) css += `;padding:${px(attr(cm, 'top'))}px ${px(attr(cm, 'right'))}px ${px(attr(cm, 'bottom'))}px ${px(attr(cm, 'left'))}px`;
          const sub = kid(tc, 'subList');
          const va = (attr(sub, 'vertAlign', 'CENTER') || '').toUpperCase();
          css += ';vertical-align:' + ({ TOP: 'top', BOTTOM: 'bottom' }[va] || 'middle');
          td.style.cssText = css;
          if (sub) this.paragraphs(td, sub);
          row.appendChild(td);
        }
        tbody.appendChild(row);
      }
      t.appendChild(tbody);
      wrap.appendChild(t);
      return wrap;
    }

    pic(pic) {
      const img = deep(pic, 'img');
      const id = attr(img, 'binaryItemIDRef');
      const src = id && this.images[id];
      const sz = kid(pic, 'curSz') || kid(pic, 'sz');
      const w = sz ? px(attr(sz, 'width')) : 0;
      const h = sz ? px(attr(sz, 'height')) : 0;
      if (!src) {
        const ph = mk('span', 'shape');
        ph.style.cssText = `width:${w || 60}px;height:${h || 40}px;border:1px dashed #bbb;text-indent:0`;
        return ph;
      }
      const im = mk('img');
      im.src = src;
      im.alt = '';
      if (w) im.style.width = w + 'px';
      const pos = kid(pic, 'pos');
      const inl = attr(pos, 'treatAsChar', '1') === '1';
      if (inl) im.style.verticalAlign = 'bottom';
      else {
        const wrap = mk('div');
        wrap.style.cssText = 'text-indent:0;text-align:' + ({ CENTER: 'center', RIGHT: 'right' }[(attr(pos, 'horzAlign', '') || '').toUpperCase()] || 'left');
        wrap.appendChild(im);
        return wrap;
      }
      return im;
    }

    shape(n) {
      const box = mk('span', 'shape');
      const sz = kid(n, 'curSz') || kid(n, 'sz');
      let css = 'text-indent:0;';
      if (sz) css += `width:${px(attr(sz, 'width'))}px;min-height:${px(attr(sz, 'height'))}px;`;
      const ls = kid(n, 'lineShape');
      if (ls && lineStyle(attr(ls, 'style', 'SOLID'))) css += `border:1px ${lineStyle(attr(ls, 'style'))} ${color(attr(ls, 'color')) || '#000'};`;
      const wb = deep(n, 'winBrush');
      if (wb) { const fc = color(attr(wb, 'faceColor')); if (fc) css += `background:${fc};`; }
      if (n.localName === 'ellipse') css += 'border-radius:50%;';
      box.style.cssText = css;
      const dt = deep(n, 'drawText');
      const sub = dt && kid(dt, 'subList');
      if (sub) { box.style.padding = '4px'; this.paragraphs(box, sub); }
      // 묶음 도형 안의 그림
      if (n.localName === 'container') for (const c of n.children) { const e = this.inline(c, ''); if (e) box.appendChild(e); }
      return box;
    }
  }

  function pageSetup(sec) {
    const secPr = deep(sec, 'secPr');
    const pp = kid(secPr, 'pagePr');
    let w = +attr(pp, 'width', 59528), h = +attr(pp, 'height', 84186);
    if ((attr(pp, 'landscape', 'WIDELY') || '').toUpperCase() === 'NARROWLY' && w < h) [w, h] = [h, w];
    const m = kid(pp, 'margin');
    return {
      width: px(w), height: px(h),
      left: px(attr(m, 'left', 8504)), right: px(attr(m, 'right', 8504)),
      top: px(+attr(m, 'top', 5668) + +attr(m, 'header', 4252)),
      bottom: px(+attr(m, 'bottom', 4252) + +attr(m, 'footer', 4252)),
    };
  }

  function newPage(container, ps) {
    const page = mk('div', 'page hwpx-page');
    page.style.cssText = `width:${ps.width}px;min-height:${ps.height}px;padding:${ps.top}px ${ps.right}px ${ps.bottom}px ${ps.left}px`;
    container.appendChild(page);
    return page;
  }

  async function render(buf, container) {
    const zip = await JSZip.loadAsync(buf);
    const xml = async (path) => {
      const f = zip.file(path) || zip.file(Object.keys(zip.files).find((k) => k.toLowerCase() === path.toLowerCase()) || '');
      if (!f) return null;
      return new DOMParser().parseFromString(await f.async('string'), 'application/xml');
    };

    // 매니페스트(content.hpf): 섹션 순서와 그림 파일
    const hpfPath = Object.keys(zip.files).find((k) => /content\.hpf$/i.test(k));
    const hpf = hpfPath ? await xml(hpfPath) : null;
    const base = hpfPath ? hpfPath.replace(/[^/]*$/, '') : 'Contents/';
    const items = {};
    let sections = [];
    const images = {};
    if (hpf) {
      for (const it of hpf.getElementsByTagNameNS('*', 'item')) items[attr(it, 'id')] = { href: attr(it, 'href'), type: attr(it, 'media-type', '') };
      for (const ref of hpf.getElementsByTagNameNS('*', 'itemref')) {
        const it = items[attr(ref, 'idref')];
        if (it && /section/i.test(it.href)) sections.push(it.href);
      }
    }
    if (!sections.length) {
      sections = Object.keys(zip.files).filter((k) => /Contents\/section\d+\.xml$/i.test(k))
        .sort((a, b) => +a.match(/(\d+)\.xml$/i)[1] - +b.match(/(\d+)\.xml$/i)[1]);
    }
    const resolve = (href) => (zip.file(href) ? href : zip.file(base + href) ? base + href : href);
    sections = sections.map(resolve);

    // 그림 → blob URL
    const imgJobs = [];
    for (const [id, it] of Object.entries(items)) {
      if (/^image\//.test(it.type) || /\.(png|jpe?g|gif|bmp|wmf|emf|svg|tiff?)$/i.test(it.href)) {
        const f = zip.file(resolve(it.href));
        if (!f) continue;
        imgJobs.push(f.async('blob').then((b) => {
          const ext = it.href.split('.').pop().toLowerCase();
          const type = it.type || (ext === 'jpg' ? 'image/jpeg' : 'image/' + ext);
          images[id] = URL.createObjectURL(new Blob([b], { type }));
        }));
      }
    }
    if (!hpf) {
      for (const k of Object.keys(zip.files).filter((k) => /^BinData\//i.test(k))) {
        const id = k.replace(/^BinData\//i, '').replace(/\.[^.]+$/, '');
        imgJobs.push(zip.file(k).async('blob').then((b) => { images[id] = URL.createObjectURL(b); }));
      }
    }
    await Promise.all(imgJobs);

    const header = await xml(base + 'header.xml') || await xml('Contents/header.xml');
    const r = new Renderer(buildStyles(header), images);

    container.innerHTML = '';
    let pages = 0;
    for (const sp of sections) {
      const sec = await xml(sp);
      if (!sec) continue;
      const root = sec.documentElement;
      const ps = pageSetup(root);
      let page = newPage(container, ps); pages++;
      let lastVert = -1;
      for (const p of kids(root, 'p')) {
        const seg = deep(p, 'lineseg');
        // linesegarray 는 문단 바로 아래에 있는 것만 의미 있음
        const segArr = kid(p, 'linesegarray');
        const firstSeg = segArr ? kid(segArr, 'lineseg') : null;
        const vert = firstSeg ? +attr(firstSeg, 'vertpos', -1) : -1;
        const forced = attr(p, 'pageBreak', '0') === '1';
        if (page.childElementCount && (forced || (vert >= 0 && lastVert > 0 && vert < lastVert))) {
          page = newPage(container, ps); pages++;
        }
        if (vert >= 0) {
          const lastSeg = segArr ? kids(segArr, 'lineseg').pop() : null;
          lastVert = lastSeg ? +attr(lastSeg, 'vertpos', vert) : vert;
        }
        void seg;
        page.appendChild(r.para(p));
        // 큰 문서에서 UI 가 멈추지 않도록 가끔 양보
        if (page.childElementCount % 200 === 0) await new Promise((res) => setTimeout(res));
      }
    }
    if (!pages) throw new Error('HWPX 본문(section)을 찾을 수 없습니다.');
    return { pages };
  }

  window.Hwpx = { render };
})();
