/*
 * 구형 바이너리 문서(HWP 5.0 / DOC / PPT)와 RTF·ODF 에서 텍스트를 추출한다.
 * - CFB(복합 문서) 파싱은 SheetJS 에 포함된 XLSX.CFB 를 사용
 * - HWP 압축 해제는 pako
 */
(function () {
  'use strict';

  const u8 = (x) => (x instanceof Uint8Array ? x : new Uint8Array(x));

  function readCfb(buf) {
    return XLSX.CFB.read(u8(buf), { type: 'array' });
  }

  /** 스트림 이름(경로 끝)으로 CFB 엔트리 내용을 찾는다. */
  function stream(cfb, name) {
    const want = name.toLowerCase();
    for (let i = 0; i < cfb.FullPaths.length; i++) {
      const p = cfb.FullPaths[i].toLowerCase().replace(/\/$/, '');
      if (p === want || p.endsWith('/' + want)) {
        const e = cfb.FileIndex[i];
        if (e && e.type === 2 && e.content) return u8(e.content);
      }
    }
    return null;
  }

  function hasStream(cfb, name) {
    const want = name.toLowerCase();
    return cfb.FullPaths.some((p) => {
      p = p.toLowerCase().replace(/\/$/, '');
      return p === want || p.endsWith('/' + want);
    });
  }

  const dv = (a) => new DataView(a.buffer, a.byteOffset, a.byteLength);
  const utf16 = new TextDecoder('utf-16le');
  const latin1 = new TextDecoder('windows-1252');

  // ---------------------------------------------------------------- HWP 5.0
  // 한글 문서 텍스트 추출 (hwp.js 렌더링 실패 시 대체용)
  const HWPTAG_PARA_TEXT = 67;
  const EXT_CTRL = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]);

  function hwpParagraphs(buf) {
    const cfb = readCfb(buf);
    const fh = stream(cfb, 'FileHeader');
    if (!fh) throw new Error('HWP 파일 헤더를 찾을 수 없습니다.');
    const props = dv(fh).getUint32(36, true);
    const compressed = (props & 1) !== 0;
    if (props & 2) throw new Error('암호가 걸린 한글 문서는 열 수 없습니다.');
    const distributed = (props & 4) !== 0;

    const paras = [];
    for (let s = 0; ; s++) {
      let data = stream(cfb, 'BodyText/Section' + s);
      if (!data) {
        if (s === 0 && distributed) throw new Error('배포용(열람 제한) 한글 문서는 지원하지 않습니다.');
        break;
      }
      if (compressed) {
        try { data = pako.inflateRaw(data); } catch (e) { data = pako.inflate(data); }
      }
      const v = dv(data);
      let off = 0;
      if (s > 0) paras.push({ pageBreak: true, text: '' });
      while (off + 4 <= data.length) {
        const h = v.getUint32(off, true); off += 4;
        const tag = h & 0x3ff;
        const level = (h >>> 10) & 0x3ff;
        let size = h >>> 20;
        if (size === 0xfff) { size = v.getUint32(off, true); off += 4; }
        if (tag === HWPTAG_PARA_TEXT) {
          paras.push({ level, text: hwpParaText(data, off, size) });
        }
        off += size;
      }
    }
    return paras;
  }

  function hwpParaText(data, off, size) {
    const v = dv(data);
    let out = '';
    const end = off + size;
    for (let i = off; i + 1 < end; i += 2) {
      const c = v.getUint16(i, true);
      if (c >= 32) { out += String.fromCharCode(c); continue; }
      if (EXT_CTRL.has(c)) {
        if (c === 9) out += '\t';
        i += 14; // 제어문자는 8 WCHAR(16바이트) 차지
        continue;
      }
      if (c === 10) out += '\n';
      else if (c === 24) out += '-';
      else if (c === 30 || c === 31) out += ' ';
      // 13(문단 끝) 등 나머지는 무시
    }
    return out;
  }

  // ---------------------------------------------------------------- DOC (Word 97-2003)
  function docParagraphs(buf) {
    const cfb = readCfb(buf);
    const wd = stream(cfb, 'WordDocument');
    if (!wd) throw new Error('Word 문서 스트림이 없습니다.');
    const w = dv(wd);
    if (w.getUint16(0, true) !== 0xa5ec) throw new Error('지원하지 않는 Word 형식입니다(Word 6/95 이하).');
    const flags = w.getUint16(0x0a, true);
    if (flags & 0x0100) throw new Error('암호가 걸린 Word 문서는 열 수 없습니다.');
    const table = stream(cfb, (flags & 0x0200) ? '1Table' : '0Table');
    if (!table) throw new Error('Word 문서 테이블 스트림이 없습니다.');
    const ccpText = w.getInt32(0x4c, true);
    const fcClx = w.getUint32(0x01a2, true);
    const lcbClx = w.getUint32(0x01a6, true);
    const t = dv(table);

    // Clx: Prc* 를 건너뛰고 Pcdt 찾기
    let p = fcClx;
    const clxEnd = fcClx + lcbClx;
    while (p < clxEnd && table[p] === 0x01) {
      p += 3 + t.getInt16(p + 1, true);
    }
    if (table[p] !== 0x02) throw new Error('Word 문서 구조를 해석할 수 없습니다.');
    const lcb = t.getUint32(p + 1, true);
    const plc = p + 5;
    const n = (lcb - 4) / 12;
    let text = '';
    for (let i = 0; i < n; i++) {
      const cpStart = t.getInt32(plc + i * 4, true);
      const cpEnd = t.getInt32(plc + (i + 1) * 4, true);
      if (cpStart >= ccpText) break;
      const len = Math.min(cpEnd, ccpText) - cpStart;
      const pcd = plc + (n + 1) * 4 + i * 8;
      let fc = t.getUint32(pcd + 2, true);
      const compressed = (fc & 0x40000000) !== 0;
      if (compressed) {
        fc = (fc & ~0x40000000) >>> 1;
        text += latin1.decode(wd.subarray(fc, fc + len));
      } else {
        text += utf16.decode(wd.subarray(fc, fc + len * 2));
      }
    }
    return cleanWordText(text);
  }

  function cleanWordText(text) {
    // 필드 코드(0x13 ~ 0x14) 숨기고 결과(0x14 ~ 0x15)만 남김
    let out = '';
    const stack = [];
    for (const ch of text) {
      const c = ch.charCodeAt(0);
      if (c === 0x13) { stack.push(true); continue; }
      if (c === 0x14) { if (stack.length) stack[stack.length - 1] = false; continue; }
      if (c === 0x15) { stack.pop(); continue; }
      if (stack.length && stack[stack.length - 1]) continue;
      if (c === 0x0d) out += '\n';
      else if (c === 0x07) out += '\t';
      else if (c === 0x0b) out += '\n';
      else if (c === 0x0c) out += '\n\f\n';
      else if (c === 0x1e) out += '-';
      else if (c === 0x09) out += '\t';
      else if (c < 0x20 || c === 0x1f) continue;
      else out += ch;
    }
    return out.split('\n').map((s) => s.replace(/\t+$/, ''));
  }

  // ---------------------------------------------------------------- PPT (PowerPoint 97-2003)
  function pptSlides(buf) {
    const cfb = readCfb(buf);
    const ps = stream(cfb, 'PowerPoint Document');
    if (!ps) throw new Error('PowerPoint 문서 스트림이 없습니다.');
    if (hasStream(cfb, 'EncryptedSummary')) throw new Error('암호가 걸린 PowerPoint 문서는 열 수 없습니다.');
    const v = dv(ps);

    const fromList = [];   // SlideListWithText 기준
    const fromSlides = []; // Slide 컨테이너(도형 텍스트) 기준

    function walk(start, end, ctx) {
      let off = start;
      while (off + 8 <= end) {
        const verInst = v.getUint16(off, true);
        const type = v.getUint16(off + 2, true);
        const len = v.getUint32(off + 4, true);
        const body = off + 8;
        const next = body + len;
        if (next > end || len > ps.length) break;
        const inst = verInst >>> 4;
        const isContainer = (verInst & 0x0f) === 0x0f;

        if (isContainer) {
          if (type === 0x03f0 || type === 0x03f8 || type === 0x0fc9) { /* 노트, 마스터, 핸드아웃 무시 */ }
          else if (type === 0x03e8) { // DocumentContainer: 증분 저장 시 여러 개 → 마지막(최신) 것만 사용
            fromList.length = 0;
            walk(body, next, ctx);
          }
          else if (type === 0x0ff0) { // SlideListWithText
            if (inst === 0) walk(body, next, { mode: 'list', cur: null });
          } else if (type === 0x03ee) { // Slide
            const slide = { title: '', lines: [] };
            fromSlides.push(slide);
            walk(body, next, { mode: 'slide', cur: slide, textType: -1 });
          } else {
            walk(body, next, ctx);
          }
        } else if (ctx) {
          if (ctx.mode === 'list' && type === 0x03f3) { // SlidePersistAtom
            ctx.cur = { title: '', lines: [] };
            fromList.push(ctx.cur);
          } else if (type === 0x0f9f) { // TextHeaderAtom
            ctx.textType = v.getUint32(body, true);
          } else if ((type === 0x0fa0 || type === 0x0fa8) && ctx.cur) {
            const raw = ps.subarray(body, next);
            const s = (type === 0x0fa0 ? utf16.decode(raw) : latin1.decode(raw)).replace(/[\r\v]/g, '\n').replace(/[\x00-\x08\x0e-\x1f]/g, '');
            if (s.trim()) {
              if ((ctx.textType === 0 || ctx.textType === 6) && !ctx.cur.title) ctx.cur.title = s.trim();
              else if (!ctx.cur.lines.includes(s)) ctx.cur.lines.push(s);
            }
            ctx.textType = -1;
          }
        }
        off = next;
      }
    }
    walk(0, ps.length, null);

    const size = (arr) => arr.reduce((a, s) => a + s.title.length + s.lines.join('').length, 0);
    const slides = size(fromList) >= size(fromSlides) ? fromList : fromSlides;
    return slides;
  }

  // ---------------------------------------------------------------- RTF
  function rtfText(buf) {
    const bytes = u8(buf);
    const src = latin1.decode(bytes);
    const korean = /\\ansicpg949|\\fcharset129/.test(src);
    const dec = new TextDecoder(korean ? 'euc-kr' : 'windows-1252');
    const SKIP = new Set(['fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'object', 'header', 'footer',
      'headerl', 'headerr', 'footerl', 'footerr', 'themedata', 'colorschememapping', 'latentstyles',
      'datastore', 'xmlnstbl', 'listtable', 'listoverridetable', 'rsidtbl', 'generator', 'filetbl', 'revtbl']);
    let out = '';
    let pend = [];
    const flush = () => { if (pend.length) { out += dec.decode(new Uint8Array(pend)); pend = []; } };
    const stack = [];
    let skip = false, uc = 1, ucSkip = 0;
    const re = /\\([a-zA-Z]+)(-?\d+)? ?|\\'([0-9a-fA-F]{2})|\\([^a-zA-Z])|([{}])|[\r\n]+|([^\\{}\r\n]+)/g;
    let m;
    while ((m = re.exec(src))) {
      const [, word, arg, hex, sym, brace, text] = m;
      if (brace === '{') { flush(); stack.push([skip, uc]); continue; }
      if (brace === '}') { flush(); [skip, uc] = stack.pop() || [false, 1]; continue; }
      if (hex) {
        if (ucSkip > 0) { ucSkip--; continue; }
        if (!skip) pend.push(parseInt(hex, 16));
        continue;
      }
      flush();
      if (sym) {
        if (sym === '*') { skip = true; continue; }
        if (skip) continue;
        if (sym === '~') out += ' ';
        else if (sym === '-') { /* optional hyphen */ }
        else if (sym === '_') out += '-';
        else if (sym === '\\' || sym === '{' || sym === '}') out += sym;
        continue;
      }
      if (word) {
        if (SKIP.has(word)) { skip = true; continue; }
        if (word === 'uc') { uc = +arg; continue; }
        if (skip) continue;
        if (word === 'par' || word === 'line' || word === 'sect' || word === 'row') out += '\n';
        else if (word === 'tab' || word === 'cell') out += '\t';
        else if (word === 'page') out += '\n\f\n';
        else if (word === 'u') {
          let code = +arg; if (code < 0) code += 65536;
          out += String.fromCharCode(code); ucSkip = uc;
        }
        continue;
      }
      if (text) {
        if (skip) continue;
        let t = text;
        if (ucSkip > 0) { const k = Math.min(ucSkip, t.length); t = t.slice(k); ucSkip -= k; }
        out += t;
      }
    }
    flush();
    return out.split('\n');
  }

  // ---------------------------------------------------------------- ODF (ODT / ODP)
  async function odfContent(buf) {
    const zip = await JSZip.loadAsync(buf);
    const f = zip.file('content.xml');
    if (!f) throw new Error('OpenDocument 내용(content.xml)이 없습니다.');
    const xml = new DOMParser().parseFromString(await f.async('string'), 'application/xml');
    const paraText = (el) => {
      let s = '';
      el.childNodes.forEach((n) => {
        if (n.nodeType === 3) s += n.nodeValue;
        else if (n.nodeType === 1) {
          const ln = n.localName;
          if (ln === 's') s += ' '.repeat(+(n.getAttribute('text:c') || 1));
          else if (ln === 'tab') s += '\t';
          else if (ln === 'line-break') s += '\n';
          else if (ln === 'note') { /* 각주 생략 */ }
          else s += paraText(n);
        }
      });
      return s;
    };
    const collect = (root) => {
      const out = [];
      const walk = (el) => {
        for (const c of el.children) {
          if (c.localName === 'p' || c.localName === 'h') out.push({ heading: c.localName === 'h', text: paraText(c) });
          else walk(c);
        }
      };
      walk(root);
      return out;
    };
    const pages = Array.from(xml.getElementsByTagNameNS('*', 'page')).filter((p) => p.namespaceURI && p.namespaceURI.includes('drawing'));
    if (pages.length) {
      return { slides: pages.map((pg) => collect(pg).map((p) => p.text).filter((s) => s.trim())) };
    }
    const body = xml.getElementsByTagNameNS('*', 'text')[0] || xml.documentElement;
    return { paragraphs: collect(body) };
  }

  /** CFB 스트림 목록으로 구형 문서 종류를 판별 */
  function cfbKind(buf) {
    try {
      const cfb = readCfb(buf);
      if (hasStream(cfb, 'FileHeader') && (hasStream(cfb, 'BodyText') || hasStream(cfb, 'ViewText') || hasStream(cfb, 'DocInfo'))) return 'hwp';
      if (hasStream(cfb, 'WordDocument')) return 'doc';
      if (hasStream(cfb, 'Workbook') || hasStream(cfb, 'Book')) return 'xls';
      if (hasStream(cfb, 'PowerPoint Document')) return 'ppt';
      if (hasStream(cfb, 'EncryptionInfo')) return 'encrypted';
    } catch (e) { /* ignore */ }
    return null;
  }

  window.Legacy = { hwpParagraphs, docParagraphs, pptSlides, rtfText, odfContent, cfbKind };
})();
