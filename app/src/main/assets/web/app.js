/* 하마 문서뷰어 - 화면 제어 및 형식별 렌더링 */
(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const Android = window.Android || {
    // 브라우저에서 테스트할 때 쓰는 대체 구현
    getPending: () => '', openedFromOutside: () => false, pickFile: () => devPick(),
    openRecent: () => {}, share: () => {}, openWithOther: () => {}, toast: (m) => console.log(m), close: () => {},
    appVersion: () => 'dev', checkUpdate: () => {}, downloadUpdate: () => {}, openReleasePage: () => {},
  };

  const home = $('#home'), viewer = $('#viewer'), docEl = $('#doc'), statusEl = $('#status');
  const titleEl = $('#title'), menu = $('#menu'), tabs = $('#sheetTabs');
  const state = { info: null, kind: null, zoom: 1, fromOutside: false, cleanup: [] };

  // ------------------------------------------------------------ 화면 전환
  function showHome() {
    resetViewer();
    state.info = null;
    home.hidden = false; viewer.hidden = true;
    $('#btnBack').hidden = true; $('#btnMore').hidden = true; $('#btnOpen').hidden = false;
    titleEl.textContent = '하마 문서뷰어';
    renderRecent();
  }

  function showViewer(name) {
    home.hidden = true; viewer.hidden = false;
    $('#btnBack').hidden = false; $('#btnMore').hidden = false; $('#btnOpen').hidden = true;
    titleEl.textContent = name;
    document.title = name;
  }

  function resetViewer() {
    state.cleanup.forEach((fn) => { try { fn(); } catch (e) { /* ignore */ } });
    state.cleanup = [];
    docEl.innerHTML = '';
    docEl.style.zoom = 1; docEl.style.transform = '';
    state.zoom = 1;
    tabs.hidden = true; tabs.innerHTML = '';
    viewer.scrollTo(0, 0);
  }

  function setStatus(msg) {
    statusEl.textContent = msg || '';
    statusEl.hidden = !msg;
  }

  // ------------------------------------------------------------ 문서 열기
  window.openDocument = async function (info) {
    menu.hidden = true;
    resetViewer();
    state.info = info;
    state.fromOutside = !!Android.openedFromOutside();
    showViewer(info.name || '문서');
    setStatus('문서를 여는 중…');
    state.parent = info.parent || null; // 압축 파일 안에서 연 경우 돌아갈 곳
    try {
      const pre = mediaKind(info.name || '', info.mime || '');
      if (pre) {
        state.kind = pre;
        if (!state.fromOutside) saveRecent(info, pre);
        await RENDER[pre](null, docEl, info);
        setStatus('');
        return;
      }
      const res = await fetch(info.url, { cache: 'no-store' });
      if (!res.ok) throw new Error(await res.text() || ('HTTP ' + res.status));
      const buf = await res.arrayBuffer();
      if (!buf.byteLength) throw new Error('빈 파일입니다.');
      const kind = await detectKind(buf, info.name || '', info.mime || '');
      state.kind = kind;
      if (!state.fromOutside) saveRecent(info, kind);
      const fn = RENDER[kind];
      if (!fn) throw Object.assign(new Error('지원하지 않는 파일 형식입니다.'), { unsupported: true });
      await fn(buf, docEl, info);
      setStatus('');
    } catch (e) {
      console.error(e);
      setStatus('');
      showError(e);
    }
  };

  function showError(e) {
    docEl.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'error-box';
    box.innerHTML = `<h3>${e.unsupported ? '열 수 없는 형식' : '문서를 열지 못했습니다'}</h3><p></p>
      <button class="secondary" data-act="other">다른 앱으로 열기</button>
      <button class="secondary" data-act="open">다른 파일 열기</button>`;
    box.querySelector('p').textContent = e.message || String(e);
    docEl.appendChild(box);
  }

  // ------------------------------------------------------------ 형식 판별
  const EXT = {
    hwp: 'hwp', hwt: 'hwp', hwpx: 'hwpx', hwtx: 'hwpx', owpml: 'hwpx',
    docx: 'docx', docm: 'docx', dotx: 'docx', dotm: 'docx', doc: 'doc', dot: 'doc',
    xlsx: 'sheet', xlsm: 'sheet', xltx: 'sheet', xltm: 'sheet', xlsb: 'sheet', xls: 'sheet', xlt: 'sheet', ods: 'sheet', fods: 'sheet',
    csv: 'csv', tsv: 'csv',
    pptx: 'pptx', pptm: 'pptx', ppsx: 'pptx', potx: 'pptx', ppsm: 'pptx', ppt: 'ppt', pps: 'ppt', pot: 'ppt',
    pdf: 'pdf', odt: 'odt', odp: 'odp', rtf: 'rtf',
    md: 'markdown', markdown: 'markdown', mdown: 'markdown', mkd: 'markdown', mdx: 'markdown',
    html: 'html', htm: 'html', xhtml: 'html', json: 'json', geojson: 'json', ipynb: 'json',
    zip: 'zip', jar: 'zip', apk: 'zip', epub: 'epub',
  };
  // 텍스트로 여는 확장자 (코드·설정·자막 등)
  ('txt text log xml ini cfg conf yaml yml toml properties env js mjs cjs jsx tsx css scss less java kt kts gradle py rb php go rs '
    + 'swift c cc cpp h hpp cs vb lua pl r scala sql sh bash zsh bat cmd ps1 vbs m mm dart groovy ex exs erl hs clj tex bib asm '
    + 'srt vtt smi ass ssa sub lrc nfo diff patch gitignore gitattributes editorconfig dockerfile makefile cmake reg inf url desktop '
    + 'vcf ics svelte vue astro gql graphql proto csproj sln plist mhtml').split(' ').forEach((e) => { if (!EXT[e]) EXT[e] = 'text'; });

  const IMAGE_EXT = new Set('jpg jpeg jfif png gif webp bmp ico svg avif heic heif tif tiff'.split(' '));
  const VIDEO_EXT = new Set('mp4 m4v webm mkv mov 3gp 3g2 ogv'.split(' '));
  const AUDIO_EXT = new Set('mp3 m4a aac wav ogg oga opus flac amr weba'.split(' '));

  /** 이미지·동영상·음악은 내용을 통째로 읽지 않고 바로 스트리밍 */
  function mediaKind(name, mime) {
    const ext = (name.match(/\.([^.]+)$/) || [])[1]?.toLowerCase() || '';
    if (IMAGE_EXT.has(ext)) return 'image';
    if (VIDEO_EXT.has(ext)) return 'video';
    if (AUDIO_EXT.has(ext)) return 'audio';
    if (EXT[ext]) return null;
    if (/^image\//.test(mime)) return 'image';
    if (/^video\//.test(mime)) return 'video';
    if (/^audio\//.test(mime)) return 'audio';
    return null;
  }

  async function detectKind(buf, name, mime) {
    const ext = (name.match(/\.([^.]+)$/) || [])[1]?.toLowerCase() || '';
    const head = new Uint8Array(buf, 0, Math.min(buf.byteLength, 32));
    const ascii = String.fromCharCode(...head);

    if (ascii.startsWith('%PDF')) return 'pdf';
    if (ascii.startsWith('{\\rtf')) return 'rtf';
    if (ascii.startsWith('HWP Document File')) return 'hwp3';

    if (head[0] === 0x50 && head[1] === 0x4b) { // ZIP 계열
      try {
        const zip = await JSZip.loadAsync(buf);
        const has = (p) => !!zip.file(p);
        let mt = '';
        if (has('mimetype')) mt = (await zip.file('mimetype').async('string')).trim();
        if (/hwp/i.test(mt) || has('Contents/header.xml') || has('Contents/section0.xml')) return 'hwpx';
        if (has('word/document.xml') || Object.keys(zip.files).some((k) => /^word\/document\d*\.xml$/.test(k))) return 'docx';
        if (has('xl/workbook.xml') || has('xl/workbook.bin')) return 'sheet';
        if (has('ppt/presentation.xml')) return 'pptx';
        if (mt.includes('opendocument.text')) return 'odt';
        if (mt.includes('opendocument.spreadsheet')) return 'sheet';
        if (mt.includes('opendocument.presentation')) return 'odp';
        if (mt.includes('epub') || has('META-INF/container.xml')) return 'epub';
        if (!EXT[ext]) return 'zip';
      } catch (e) { /* 손상된 zip */ }
    }
    if (head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0) { // CFB(구형 오피스/HWP)
      const k = Legacy.cfbKind(buf);
      if (k === 'xls') return 'sheet';
      if (k === 'encrypted') return 'encrypted';
      if (k) return k;
    }
    if (EXT[ext]) return EXT[ext];
    if (/pdf/.test(mime)) return 'pdf';
    if (/hwpx|hwp\+zip/.test(mime)) return 'hwpx';
    if (/hwp/.test(mime)) return 'hwp';
    if (/csv/.test(mime)) return 'csv';
    if (/markdown/.test(mime)) return 'markdown';
    if (/html/.test(mime)) return 'html';
    if (/json/.test(mime)) return 'json';
    if (/^text\//.test(mime)) return 'text';
    if (looksLikeText(new Uint8Array(buf, 0, Math.min(buf.byteLength, 4096)))) return 'text';
    return 'hex'; // 해석할 수 없는 파일도 16진수로라도 보여 줌
  }

  function looksLikeText(b) {
    let bad = 0;
    for (const c of b) if (c === 0 || (c < 9) || (c > 13 && c < 32 && c !== 27)) bad++;
    return b.length > 0 && bad / b.length < 0.01;
  }

  function decodeText(buf) {
    const b = new Uint8Array(buf);
    if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b);
    if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b);
    try { return new TextDecoder('utf-8', { fatal: true }).decode(b); } catch (e) { /* 아래로 */ }
    return new TextDecoder('euc-kr').decode(b); // 한국어 ANSI(CP949) 텍스트
  }

  // ------------------------------------------------------------ 렌더러
  const RENDER = {
    async hwp(buf, el) {
      const host = mk('div', 'hwp-host');
      el.appendChild(host);
      try {
        // eslint-disable-next-line no-new
        new HwpViewer(host, new Uint8Array(buf), { type: 'array' });
        if (!host.textContent.trim() && !host.querySelector('img')) throw new Error('빈 결과');
        tweakHwpJs(host);
        await nextFrame();
        fitWidth();
      } catch (e) {
        console.warn('hwp.js 렌더링 실패, 텍스트 모드로 전환', e);
        host.remove();
        const paras = Legacy.hwpParagraphs(buf); // 여기서 실패하면 오류 표시
        el.appendChild(notice('서식이 복잡해 일부 서식 없이 텍스트로 표시합니다.'));
        el.appendChild(textPage(paras.map((p) => p.text)));
      }
    },

    async hwpx(buf, el) {
      await Hwpx.render(buf, el);
      await nextFrame();
      fitWidth();
    },

    hwp3() {
      throw new Error('한글 97 이전(HWP 3.0) 형식은 지원하지 않습니다. 한글 프로그램에서 HWP/HWPX로 다시 저장해 주세요.');
    },

    async docx(buf, el) {
      const host = mk('div', 'docx-host');
      el.appendChild(host);
      await docxPreview.renderAsync(buf, host, null, {
        className: 'docx', inWrapper: true, breakPages: true, ignoreLastRenderedPageBreak: true,
        experimental: true, useBase64URL: true, renderHeaders: true, renderFooters: true,
        renderFootnotes: true, renderEndnotes: true,
      });
      await nextFrame();
      fitWidth();
    },

    async doc(buf, el) {
      const lines = Legacy.docParagraphs(buf);
      el.appendChild(notice('Word 97-2003(.doc) 문서는 본문 텍스트만 표시합니다. (표·그림 서식 제외)'));
      el.appendChild(textPage(lines));
    },

    async sheet(buf, el) {
      const wb = XLSX.read(buf, { type: 'array', cellDates: true, cellNF: false, cellStyles: true, dense: false });
      showWorkbook(wb, el);
    },

    async csv(buf, el, info) {
      const text = decodeText(buf);
      const isTsv = /\.tsv$/i.test(info.name || '');
      const wb = XLSX.read(text, { type: 'string', raw: true, FS: isTsv ? '\t' : undefined });
      showWorkbook(wb, el);
    },

    async pptx(buf, el) {
      const host = mk('div', 'pptx-host');
      host.style.width = '960px';
      el.appendChild(host);
      const pv = pptxPreview.init(host, { width: 960, height: 540, mode: 'list' });
      state.cleanup.push(() => pv.destroy && pv.destroy());
      await pv.preview(buf);
      await nextFrame();
      fitWidth();
    },

    async ppt(buf, el) {
      const slides = Legacy.pptSlides(buf);
      el.appendChild(notice('PowerPoint 97-2003(.ppt) 문서는 슬라이드의 텍스트만 표시합니다.'));
      if (!slides.length) throw new Error('슬라이드에서 텍스트를 찾지 못했습니다.');
      slides.forEach((s, i) => el.appendChild(slideCard(i + 1, s.title, s.lines)));
    },

    async odt(buf, el) {
      const r = await Legacy.odfContent(buf);
      el.appendChild(notice('OpenDocument 텍스트는 본문 텍스트만 표시합니다.'));
      el.appendChild(textPage(r.paragraphs.map((p) => p.text)));
    },

    async odp(buf, el) {
      const r = await Legacy.odfContent(buf);
      el.appendChild(notice('OpenDocument 프레젠테이션은 텍스트만 표시합니다.'));
      (r.slides || []).forEach((lines, i) => el.appendChild(slideCard(i + 1, lines[0] || '', lines.slice(1))));
    },

    async rtf(buf, el) {
      el.appendChild(textPage(Legacy.rtfText(buf)));
    },

    async text(buf, el) {
      const LIMIT = 3 * 1048576;
      if (buf.byteLength > LIMIT) el.appendChild(notice(`파일이 커서 앞부분 ${LIMIT / 1048576}MB만 표시합니다.`));
      const page = mk('div', 'page text-page mono');
      page.textContent = decodeText(buf.byteLength > LIMIT ? buf.slice(0, LIMIT) : buf);
      el.appendChild(page);
    },

    async markdown(buf, el) {
      const page = mk('div', 'page md-page');
      page.innerHTML = DOMPurify.sanitize(marked.parse(decodeText(buf), { gfm: true }));
      el.appendChild(page);
    },

    async html(buf, el) {
      const src = decodeText(buf);
      const bar = notice('웹 페이지(HTML) 미리보기입니다. 안전을 위해 스크립트는 실행하지 않습니다. ');
      const toggle = mk('button', 'link'); toggle.textContent = '소스 보기';
      bar.appendChild(toggle);
      el.appendChild(bar);
      const frame = document.createElement('iframe');
      frame.className = 'page html-frame';
      frame.setAttribute('sandbox', 'allow-same-origin'); // 스크립트 실행 금지
      frame.srcdoc = src;
      const fit = () => { try { frame.style.height = (frame.contentDocument.documentElement.scrollHeight + 24) + 'px'; } catch (e) { /* ignore */ } };
      frame.onload = () => { fit(); setTimeout(fit, 500); };
      const source = mk('div', 'page text-page mono'); source.textContent = src; source.hidden = true;
      toggle.onclick = () => {
        source.hidden = !source.hidden; frame.hidden = !source.hidden;
        toggle.textContent = source.hidden ? '소스 보기' : '미리보기';
      };
      el.append(frame, source);
    },

    async json(buf, el) {
      const t = decodeText(buf);
      let out = t;
      try { out = JSON.stringify(JSON.parse(t), null, 2); } catch (e) { /* 그대로 표시 */ }
      const page = mk('div', 'page text-page mono');
      page.textContent = out;
      el.appendChild(page);
    },

    async image(_, el, info) {
      const img = new Image();
      img.className = 'image-view';
      img.alt = info.name || '';
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = () => rej(new Error('이 이미지 형식은 표시할 수 없습니다. (HEIC·TIFF 등은 ⋮ → 다른 앱으로 열기)'));
        img.src = info.url;
      });
      const wrap = mk('div', 'media-wrap');
      const cap = mk('div', 'media-cap'); cap.textContent = `${img.naturalWidth} × ${img.naturalHeight}`;
      wrap.append(img, cap);
      el.appendChild(wrap);
    },

    async video(_, el, info) { mediaPlayer('video', el, info); },
    async audio(_, el, info) { mediaPlayer('audio', el, info); },

    async zip(buf, el, info) {
      const zip = await JSZip.loadAsync(buf);
      const files = Object.values(zip.files).filter((f) => !f.dir);
      const page = mk('div', 'page list-page');
      const h = mk('div', 'list-head'); h.textContent = `압축 파일 · ${files.length}개 항목 (눌러서 열기)`;
      page.appendChild(h);
      const ul = mk('ul', 'zip-list');
      files.sort((a, b) => a.name.localeCompare(b.name, 'ko')).forEach((f) => {
        const li = mk('li');
        const n = mk('span', 'name'); n.textContent = f.name;
        const sz = mk('span', 'size');
        const raw = f._data && f._data.uncompressedSize;
        sz.textContent = raw != null ? fmtSize(raw) : '';
        li.append(n, sz);
        li.onclick = async () => {
          setStatus('압축을 푸는 중…');
          const blob = await f.async('blob');
          const url = URL.createObjectURL(blob);
          window.openDocument({ name: f.name.split('/').pop(), mime: '', url, parent: info });
        };
        ul.appendChild(li);
      });
      page.appendChild(ul);
      el.appendChild(page);
    },

    async epub(buf, el) {
      const zip = await JSZip.loadAsync(buf);
      const getFile = (p) => zip.file(p) || zip.file(decodeURIComponent(p));
      const container = getFile('META-INF/container.xml');
      const cdoc = container && new DOMParser().parseFromString(await container.async('string'), 'application/xml');
      const opfPath = cdoc && cdoc.getElementsByTagNameNS('*', 'rootfile')[0]?.getAttribute('full-path');
      if (!opfPath) throw new Error('EPUB 구조를 해석할 수 없습니다.');
      const opf = new DOMParser().parseFromString(await getFile(opfPath).async('string'), 'application/xml');
      const base = opfPath.replace(/[^/]*$/, '');
      const items = {};
      for (const it of opf.getElementsByTagNameNS('*', 'item')) items[it.getAttribute('id')] = it.getAttribute('href');
      const spine = [...opf.getElementsByTagNameNS('*', 'itemref')].map((r) => items[r.getAttribute('idref')]).filter(Boolean);
      const resolve = (from, rel) => {
        const out = [];
        for (const p of (from.replace(/[^/]*$/, '') + rel).split('/')) { if (p === '..') out.pop(); else if (p !== '.') out.push(p); }
        return out.join('/');
      };
      for (const href of spine) {
        const path = base + href;
        const f = getFile(path);
        if (!f) continue;
        const doc = new DOMParser().parseFromString(await f.async('string'), 'text/html');
        const page = mk('div', 'page md-page');
        page.innerHTML = DOMPurify.sanitize(doc.body ? doc.body.innerHTML : '');
        for (const img of page.querySelectorAll('img')) {
          const src = img.getAttribute('src');
          const imgFile = src && getFile(resolve(path, src));
          if (imgFile) img.src = URL.createObjectURL(await imgFile.async('blob'));
          else img.remove();
        }
        el.appendChild(page);
      }
      if (!el.querySelector('.md-page')) throw new Error('EPUB 본문을 찾지 못했습니다.');
    },

    async hex(buf, el, info) {
      el.appendChild(notice('이 형식은 내용을 해석할 수 없어 16진수로 보여 줍니다. 전용 앱이 있다면 ⋮ → 다른 앱으로 열기를 이용하세요.'));
      const MAX = 64 * 1024;
      const b = new Uint8Array(buf, 0, Math.min(buf.byteLength, MAX));
      const lines = [`${info.name || ''}  (${fmtSize(buf.byteLength)})`, ''];
      for (let off = 0; off < b.length; off += 16) {
        const row = b.subarray(off, off + 16);
        const hex = [...row].map((x) => x.toString(16).padStart(2, '0')).join(' ').padEnd(47, ' ');
        const asc = [...row].map((x) => (x >= 32 && x < 127 ? String.fromCharCode(x) : '.')).join('');
        lines.push(`${off.toString(16).padStart(8, '0')}  ${hex}  ${asc}`);
      }
      if (buf.byteLength > MAX) lines.push('', `… 처음 ${MAX / 1024}KB만 표시`);
      const page = mk('div', 'page text-page mono hex');
      page.textContent = lines.join('\n');
      el.appendChild(page);
    },

    async pdf(buf, el) {
      const pdfjs = await import('./lib/pdf.min.js');
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('./lib/pdf.worker.min.js', location.href).href;
      const doc = await pdfjs.getDocument({
        data: new Uint8Array(buf),
        cMapUrl: new URL('./lib/cmaps/', location.href).href, cMapPacked: true,
        standardFontDataUrl: new URL('./lib/standard_fonts/', location.href).href,
        isEvalSupported: false,
      }).promise;
      state.cleanup.push(() => doc.destroy());
      const avail = viewer.clientWidth - 16;
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const holders = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const vp = page.getViewport({ scale: 1 });
        const cssW = Math.min(avail, vp.width * 1.6);
        const cssH = cssW * vp.height / vp.width;
        const div = mk('div', 'pdf-page');
        div.style.width = cssW + 'px'; div.style.height = cssH + 'px';
        div._page = page; div._scale = cssW / vp.width;
        el.appendChild(div);
        holders.push(div);
        if (i === 1) setStatus('');
      }
      const renderPage = async (div) => {
        if (div._done) return;
        div._done = true;
        const scale = div._scale * dpr * 1.5;
        const vp = div._page.getViewport({ scale });
        const c = document.createElement('canvas');
        c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
        div.appendChild(c);
        await div._page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      };
      const io = new IntersectionObserver((ents) => {
        ents.forEach((e) => { if (e.isIntersecting) renderPage(e.target); });
      }, { root: viewer, rootMargin: '600px 0px' });
      holders.forEach((h) => io.observe(h));
      state.cleanup.push(() => io.disconnect());
    },

    encrypted() {
      throw new Error('암호가 걸린 문서는 열 수 없습니다.');
    },
  };

  // hwp.js 가 그리는 자체 헤더/고정 높이 정리
  function tweakHwpJs(host) {
    const root = host.firstElementChild;
    if (!root) return;
    Object.assign(root.style, { overflow: 'visible', background: 'transparent', width: 'auto', height: 'auto' });
    let maxW = 0;
    for (const c of root.children) {
      if (c.style.position === 'absolute') { c.style.display = 'none'; continue; } // 자체 헤더·정보 창
      Object.assign(c.style, { padding: '0', overflow: 'visible' });
      for (const pg of c.children) {
        pg.style.margin = '0 auto 12px';
        maxW = Math.max(maxW, pg.offsetWidth);
      }
    }
    if (maxW) host.style.width = maxW + 'px';
  }

  // ------------------------------------------------------------ 엑셀
  function showWorkbook(wb, el) {
    const names = wb.SheetNames;
    if (!names.length) throw new Error('시트가 없습니다.');
    tabs.innerHTML = '';
    names.forEach((n, i) => {
      const b = document.createElement('button');
      b.textContent = n;
      b.onclick = () => select(i);
      tabs.appendChild(b);
    });
    tabs.hidden = names.length < 2;
    const select = (i) => {
      [...tabs.children].forEach((b, j) => b.classList.toggle('on', i === j));
      el.innerHTML = '';
      el.appendChild(sheetTable(wb.Sheets[names[i]]));
      viewer.scrollTo(0, 0);
    };
    select(0);
  }

  const MAX_ROWS = 5000, MAX_COLS = 200;
  function sheetTable(ws) {
    const wrap = mk('div', 'sheet-wrap');
    if (!ws || !ws['!ref']) { wrap.appendChild(notice('빈 시트입니다.')); return wrap; }
    const range = XLSX.utils.decode_range(ws['!ref']);
    const r0 = range.s.r, c0 = range.s.c;
    const r1 = Math.min(range.e.r, r0 + MAX_ROWS - 1), c1 = Math.min(range.e.c, c0 + MAX_COLS - 1);
    const skip = new Set(), span = {};
    (ws['!merges'] || []).forEach((m) => {
      span[m.s.r + ':' + m.s.c] = [m.e.r - m.s.r + 1, m.e.c - m.s.c + 1];
      for (let r = m.s.r; r <= m.e.r; r++) for (let c = m.s.c; c <= m.e.c; c++) if (r !== m.s.r || c !== m.s.c) skip.add(r + ':' + c);
    });
    const cols = ws['!cols'] || [], rows = ws['!rows'] || [];
    const t = mk('table', 'sheet');
    const cg = mk('colgroup');
    const c0w = mk('col'); c0w.style.width = '44px'; cg.appendChild(c0w);
    for (let c = c0; c <= c1; c++) {
      const col = mk('col');
      const ci = cols[c];
      let w = 80;
      if (ci) { if (ci.hidden) w = 0; else if (ci.wpx) w = ci.wpx; else if (ci.wch) w = ci.wch * 7 + 10; else if (ci.width) w = ci.width * 7; }
      col.style.width = w + 'px';
      cg.appendChild(col);
    }
    t.appendChild(cg);
    const thead = mk('thead'), hr = mk('tr');
    const corner = mk('th', 'rh corner'); hr.appendChild(corner);
    for (let c = c0; c <= c1; c++) { const th = mk('th'); th.textContent = XLSX.utils.encode_col(c); hr.appendChild(th); }
    thead.appendChild(hr); t.appendChild(thead);
    const tb = mk('tbody');
    const frag = document.createDocumentFragment();
    for (let r = r0; r <= r1; r++) {
      const ri = rows[r];
      if (ri && ri.hidden) continue;
      const tr = mk('tr');
      if (ri && ri.hpx) tr.style.height = ri.hpx + 'px';
      const th = mk('th', 'rh'); th.textContent = r + 1; tr.appendChild(th);
      for (let c = c0; c <= c1; c++) {
        const key = r + ':' + c;
        if (skip.has(key)) continue;
        const td = mk('td');
        const sp = span[key];
        if (sp) { if (sp[0] > 1) td.rowSpan = sp[0]; if (sp[1] > 1) td.colSpan = sp[1]; }
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        if (cell) {
          let v = cell.w != null ? cell.w : (cell.v instanceof Date ? cell.v.toLocaleDateString('ko-KR') : cell.v);
          if (v == null) v = '';
          td.textContent = String(v);
          if (cell.t === 'n') td.className = 'n';
          if (typeof v === 'string' && v.includes('\n')) td.classList.add('wrap');
          const fill = cell.s && cell.s.fgColor && cell.s.fgColor.rgb;
          if (fill && cell.s.patternType === 'solid' && !/^(FFFFFF|FFFFFFFF)$/i.test(fill)) td.style.background = '#' + fill.slice(-6);
        }
        tr.appendChild(td);
      }
      frag.appendChild(tr);
    }
    tb.appendChild(frag);
    t.appendChild(tb);
    if (range.e.r > r1 || range.e.c > c1) wrap.appendChild(notice(`시트가 커서 처음 ${MAX_ROWS.toLocaleString()}행 × ${MAX_COLS}열까지만 표시합니다.`));
    wrap.appendChild(t);
    return wrap;
  }

  // ------------------------------------------------------------ 공통 조각
  function mk(tag, cls) { const e = document.createElement(tag); if (cls) e.className = cls; return e; }
  // 레이아웃 반영 대기 (백그라운드에서 rAF 가 멈춰도 진행되도록 setTimeout 병행)
  function nextFrame() {
    return new Promise((r) => {
      let done = false;
      const fin = () => { if (!done) { done = true; setTimeout(r, 30); } };
      requestAnimationFrame(fin);
      setTimeout(fin, 120);
    });
  }
  function fmtSize(n) {
    if (n < 1024) return n + 'B';
    if (n < 1048576) return (n / 1024).toFixed(1) + 'KB';
    if (n < 1073741824) return (n / 1048576).toFixed(1) + 'MB';
    return (n / 1073741824).toFixed(2) + 'GB';
  }

  function mediaPlayer(tag, el, info) {
    const wrap = mk('div', 'media-wrap' + (tag === 'audio' ? ' audio' : ''));
    if (tag === 'audio') {
      const icon = mk('div', 'audio-icon'); icon.textContent = '♪';
      const t = mk('div', 'media-cap'); t.textContent = info.name || '';
      wrap.append(icon, t);
    }
    const m = document.createElement(tag);
    m.controls = true;
    m.preload = 'metadata';
    m.setAttribute('playsinline', '');
    m.className = tag + '-view';
    m.onerror = () => {
      wrap.remove();
      showError(new Error('이 기기에서 재생할 수 없는 형식입니다. ⋮ → 다른 앱으로 열기를 이용하세요.'));
    };
    m.src = info.url;
    wrap.appendChild(m);
    el.appendChild(wrap);
    state.cleanup.push(() => { m.pause(); m.removeAttribute('src'); m.load(); });
  }

  function notice(msg) { const d = mk('div', 'notice'); d.textContent = msg; return d; }

  function textPage(lines) {
    const page = mk('div', 'page text-page');
    page.style.whiteSpace = 'normal';
    const frag = document.createDocumentFragment();
    let pending = 0;
    for (const raw of lines) {
      const line = raw == null ? '' : String(raw);
      if (line === '\f') { const hr = mk('hr'); hr.style.cssText = 'border:0;border-top:1px dashed #ccc;margin:18px 0'; frag.appendChild(hr); continue; }
      if (!line.trim()) { if (++pending > 1) continue; }
      else pending = 0;
      const p = mk('p');
      p.style.whiteSpace = 'pre-wrap';
      p.textContent = line || ' ';
      frag.appendChild(p);
    }
    page.appendChild(frag);
    return page;
  }

  function slideCard(num, title, lines) {
    const c = mk('div', 'slide-card');
    const n = mk('div', 'num'); n.textContent = `슬라이드 ${num}`; c.appendChild(n);
    if (title) { const t = mk('div', 'ttl'); t.textContent = title; c.appendChild(t); }
    lines.forEach((l) => { const d = mk('div', 'line'); d.textContent = l; c.appendChild(d); });
    return c;
  }

  // ------------------------------------------------------------ 확대/축소
  function contentWidth() {
    const prev = docEl.style.zoom;
    docEl.style.zoom = 1;
    let w = 0;
    for (const c of docEl.children) w = Math.max(w, c.scrollWidth, c.offsetWidth);
    docEl.style.zoom = prev;
    return w + 16; // #doc padding
  }

  function setZoom(z, cx, cy) {
    z = Math.max(0.15, Math.min(5, z));
    const old = state.zoom;
    if (cx == null) { cx = viewer.clientWidth / 2; cy = viewer.clientHeight / 2; }
    const ax = (viewer.scrollLeft + cx) / old, ay = (viewer.scrollTop + cy) / old;
    state.zoom = z;
    docEl.style.zoom = z;
    viewer.scrollLeft = ax * z - cx;
    viewer.scrollTop = ay * z - cy;
  }

  function fitWidth() {
    const w = contentWidth();
    const avail = viewer.clientWidth;
    const z = w > avail ? avail / w : 1;
    state.zoom = z;
    docEl.style.zoom = z;
  }

  // 두 손가락 확대/축소 (제스처 중엔 transform, 끝나면 zoom 으로 확정)
  (function pinch() {
    let start = null;
    const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    viewer.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) {
        const rect = viewer.getBoundingClientRect();
        const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
        const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
        start = { d: dist(e.touches), cx, cy, ratio: 1 };
        const ox = (viewer.scrollLeft + cx) / state.zoom, oy = (viewer.scrollTop + cy) / state.zoom;
        docEl.style.transformOrigin = `${ox}px ${oy}px`;
      }
    }, { passive: true });
    viewer.addEventListener('touchmove', (e) => {
      if (!start || e.touches.length !== 2) return;
      e.preventDefault();
      let ratio = dist(e.touches) / start.d;
      ratio = Math.max(0.15 / state.zoom, Math.min(5 / state.zoom, ratio));
      start.ratio = ratio;
      docEl.style.transform = `scale(${ratio})`;
    }, { passive: false });
    const end = (e) => {
      if (!start || (e.touches && e.touches.length >= 2)) return;
      const s = start; start = null;
      docEl.style.transform = '';
      if (Math.abs(s.ratio - 1) > 0.01) setZoom(state.zoom * s.ratio, s.cx, s.cy);
    };
    viewer.addEventListener('touchend', end);
    viewer.addEventListener('touchcancel', end);
  })();

  // ------------------------------------------------------------ 최근 문서
  const RECENT_KEY = 'recent.v1';
  const BADGE = { hwp: ['HWP', '#1a8fd8'], hwpx: ['HWPX', '#1a8fd8'], docx: ['DOCX', '#2b579a'], doc: ['DOC', '#2b579a'], sheet: ['XLS', '#217346'], csv: ['CSV', '#217346'], pptx: ['PPTX', '#c43e1c'], ppt: ['PPT', '#c43e1c'], pdf: ['PDF', '#d93025'], markdown: ['MD', '#475467'], html: ['HTML', '#e8710a'], json: ['JSON', '#475467'], text: ['TXT', '#6b7280'], image: ['IMG', '#7c3aed'], video: ['VID', '#0f766e'], audio: ['MP3', '#0f766e'], zip: ['ZIP', '#a16207'], epub: ['EPUB', '#9333ea'] };
  function loadRecent() { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch (e) { return []; } }
  function storeRecent(list) { try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 20))); } catch (e) { /* ignore */ } }
  function saveRecent(info, kind) {
    if (!info.uri) return;
    const list = loadRecent().filter((r) => r.uri !== info.uri);
    list.unshift({ uri: info.uri, name: info.name, kind, t: Date.now() });
    storeRecent(list);
  }
  function renderRecent() {
    const list = loadRecent();
    $('#recentCard').hidden = !list.length;
    const ul = $('#recent');
    ul.innerHTML = '';
    list.forEach((r) => {
      const li = mk('li');
      const [label, colr] = BADGE[r.kind] || [((r.name || '').split('.').pop() || '?').toUpperCase().slice(0, 4), '#6b7280'];
      const b = mk('span', 'badge'); b.textContent = label; b.style.background = colr;
      const n = mk('span', 'name'); n.textContent = r.name;
      const tm = mk('span', 'time'); tm.textContent = new Date(r.t).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' });
      li.append(b, n, tm);
      li.onclick = () => Android.openRecent(r.uri, r.name);
      ul.appendChild(li);
    });
  }
  window.recentFailed = function (uri) {
    storeRecent(loadRecent().filter((r) => r.uri !== uri));
    renderRecent();
    Android.toast('파일을 찾을 수 없거나 권한이 만료되었습니다.');
  };

  // ------------------------------------------------------------ 버튼/메뉴
  function act(a) {
    menu.hidden = true;
    switch (a) {
      case 'zoomIn': setZoom(state.zoom * 1.25); break;
      case 'zoomOut': setZoom(state.zoom / 1.25); break;
      case 'fit': fitWidth(); break;
      case 'share': Android.share(); break;
      case 'other': Android.openWithOther(); break;
      case 'open': Android.pickFile(); break;
      case 'update':
        if (upd.info && upd.info.newer) showUpdate(upd.info);
        else checkUpdate(true);
        break;
    }
  }

  // ------------------------------------------------------------ 업데이트
  const UPD_KEY = 'upd.v1';
  const DAY = 86400000;
  const upd = { info: null, busy: false, failed: false };
  const updState = () => { try { return JSON.parse(localStorage.getItem(UPD_KEY) || '{}'); } catch (e) { return {}; } };
  const saveUpd = (s) => { try { localStorage.setItem(UPD_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ } };
  $('#verText').textContent = '버전 ' + Android.appVersion();

  function checkUpdate(manual) {
    if (manual) Android.toast('업데이트를 확인하는 중…');
    Android.checkUpdate(!!manual);
  }

  window.onUpdateInfo = function (r) {
    if (r.error) { if (r.manual) Android.toast('업데이트 확인 실패: ' + r.error); return; }
    const s = updState(); s.lastCheck = Date.now(); saveUpd(s);
    if (!r.newer) { if (r.manual) Android.toast(`최신 버전입니다 (v${r.current})`); return; }
    upd.info = r;
    // 메뉴에 표시
    const mi = menu.querySelector('[data-act="update"]');
    mi.textContent = `업데이트 (v${r.latest})`;
    mi.classList.add('has-update');
    $('#btnMore').classList.add('badge-dot');
    if (r.manual) { showUpdate(r); return; }
    // 자동 확인: 문서를 보는 중이면 방해하지 않고 메뉴 표시만, '나중에' 누른 버전은 3일간 묻지 않음
    if (!viewer.hidden) return;
    if (s.skip === r.latest && Date.now() - (s.skipAt || 0) < 3 * DAY) return;
    showUpdate(r);
  };

  function showUpdate(r) {
    upd.failed = false;
    $('#updTitle').textContent = '새 버전이 있습니다';
    $('#updVer').textContent = `현재 v${r.current} → 새 버전 v${r.latest}` + (r.size ? ` · ${(r.size / 1048576).toFixed(1)}MB` : '');
    $('#updNotes').textContent = (r.notes || '')
      .split('\n').filter((l) => !/Generated with|^\s*$/.test(l))
      .map((l) => l.replace(/^#+\s*/, '').replace(/\*\*/g, '')).join('\n').trim();
    $('#updProg').hidden = true; $('#updBar').style.width = '0';
    setUpdMsg('');
    const go = $('#updGo'); go.disabled = upd.busy; go.textContent = '업데이트';
    $('#updBack').hidden = false;
  }
  function hideUpdate() { $('#updBack').hidden = true; }
  function setUpdMsg(m, err) { const e = $('#updMsg'); e.textContent = m; e.classList.toggle('err', !!err); }

  $('#updLater').onclick = () => {
    if (!upd.busy && upd.info) { const s = updState(); s.skip = upd.info.latest; s.skipAt = Date.now(); saveUpd(s); }
    hideUpdate();
  };
  $('#updBack').addEventListener('click', (e) => { if (e.target.id === 'updBack') $('#updLater').onclick(); });
  $('#updGo').onclick = () => {
    if (upd.failed) { Android.openReleasePage(); return; }
    upd.busy = true;
    $('#updGo').disabled = true;
    $('#updProg').hidden = false;
    setUpdMsg('내려받는 중…');
    Android.downloadUpdate();
  };

  window.onUpdateProgress = function (p) {
    const go = $('#updGo');
    if (p.error) {
      upd.busy = false; upd.failed = true;
      setUpdMsg(p.error, true);
      go.disabled = false; go.textContent = '브라우저로 받기';
      return;
    }
    if (p.needPermission) { setUpdMsg('설정 화면에서 「이 출처 허용」을 켠 뒤 뒤로 돌아오면 설치가 이어집니다.'); return; }
    if (p.installing) {
      upd.busy = false;
      $('#updBar').style.width = '100%';
      setUpdMsg('설치 화면에서 [업데이트]를 누르세요.');
      go.disabled = false; go.textContent = '다시 설치';
      return;
    }
    if (p.percent >= 0) {
      $('#updBar').style.width = p.percent + '%';
      setUpdMsg(`내려받는 중… ${p.percent}% (${(p.done / 1048576).toFixed(1)} / ${(p.total / 1048576).toFixed(1)}MB)`);
    }
  };
  docEl.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a) return;
    const href = a.getAttribute('href');
    if (href.startsWith('#')) return; // 문서 안 이동
    if (!/^(https?:|mailto:|tel:)/i.test(href)) e.preventDefault(); // 상대 경로 등은 열 수 없음
  });
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (b) { act(b.dataset.act); return; }
    if (!menu.hidden && !e.target.closest('#menu') && !e.target.closest('#btnMore')) menu.hidden = true;
  });
  $('#btnMore').onclick = () => { menu.hidden = !menu.hidden; };
  $('#btnOpen').onclick = () => Android.pickFile();
  $('#btnPick').onclick = () => Android.pickFile();
  $('#btnBack').onclick = () => { if (!window.onBack()) Android.close(); };
  $('#btnClearRecent').onclick = () => { storeRecent([]); renderRecent(); };

  /** 뒤로 가기: true 를 반환하면 앱 안에서 처리됨 */
  window.onBack = function () {
    if (!$('#updBack').hidden) { hideUpdate(); return true; }
    if (!menu.hidden) { menu.hidden = true; return true; }
    if (!viewer.hidden && state.parent) { window.openDocument(state.parent); return true; }
    if (!viewer.hidden && !state.fromOutside) { showHome(); return true; }
    return false;
  };

  window.addEventListener('resize', () => { if (state.info && ['hwp', 'hwpx', 'docx', 'pptx'].includes(state.kind)) fitWidth(); });

  // 브라우저 테스트용 파일 선택
  function devPick() {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.onchange = () => {
      const f = inp.files[0];
      if (f) window.openDocument({ name: f.name, mime: f.type, url: URL.createObjectURL(f) });
    };
    inp.click();
  }

  // ------------------------------------------------------------ 시작
  showHome();
  const pending = Android.getPending();
  if (pending) window.openDocument(JSON.parse(pending));
  // 자동 업데이트 확인: 12시간에 한 번
  if (Date.now() - (updState().lastCheck || 0) > DAY / 2) setTimeout(() => checkUpdate(false), 1500);
})();
