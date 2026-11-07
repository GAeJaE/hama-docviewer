// node build.mjs  →  app/src/main/assets/web/lib 에 라이브러리 복사/번들
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

const out = '../app/src/main/assets/web/lib';
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// hwp.js 버그 수정: HWP 내장 그림(BinData)이 비압축 저장된 경우에도 inflate 를 시도해 실패하던 문제
const patchHwpJs = {
  name: 'patch-hwpjs',
  setup(b) {
    b.onLoad({ filter: /hwp\.js[\\/]build[\\/]esm\.js$/ }, async (args) => {
      let src = await readFile(args.path, 'utf8');
      const before = src;
      src = src.replace(
        /new BinData\(extension, pako_1\.inflate\(payload, \{\s*windowBits: -15\s*\}\)\)/,
        'new BinData(extension, (function(){try{return pako_1.inflate(payload,{windowBits:-15})}catch(e){return payload instanceof Uint8Array ? payload : Uint8Array.from(payload)}})())'
      );
      if (src === before) throw new Error('hwp.js 패치 대상 코드를 찾지 못함');
      // hwp.js 버그 수정: 비압축 저장된 HWP(FileHeader 속성 bit0 = 0)도 무조건 압축 해제하던 문제
      const n0 = src.length;
      src = src.replace(/var decodedContent = pako_1\.inflate\(content, \{\s*windowBits: -15\s*\}\);/g,
        'var decodedContent = __hwpInflate(content);');
      src = src.replace('var header = parseFileHeader(container);',
        'var header = parseFileHeader(container);\n  __hwpCompressed = (cfb.find(container, "FileHeader").content[36] & 1) === 1;');
      if (src.length === n0) throw new Error('hwp.js 압축 플래그 패치 실패');
      src += `
var __hwpCompressed = true;
function __hwpInflate(d) {
  if (__hwpCompressed) return pako_1.inflate(d, { windowBits: -15 });
  return d instanceof Uint8Array ? d : Uint8Array.from(d);
}`;
      return { contents: src, loader: 'js' };
    });
  },
};

await build({
  plugins: [patchHwpJs],
  entryPoints: ['vendor-entry.js'],
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['chrome80'],
  outfile: `${out}/vendor.js`,
  define: { 'process.env.NODE_ENV': '"production"', global: 'window' },
  legalComments: 'none',
  alias: { fs: './empty-module.js', crypto: './empty-module.js', stream: './empty-module.js' },
});

// pdf.js (ES 모듈) - .mjs 대신 .js 로 복사해 WebView MIME 문제 회피
const pdf = 'node_modules/pdfjs-dist';
cpSync(`${pdf}/build/pdf.min.mjs`, `${out}/pdf.min.js`);
cpSync(`${pdf}/build/pdf.worker.min.mjs`, `${out}/pdf.worker.min.js`);
cpSync(`${pdf}/cmaps`, `${out}/cmaps`, { recursive: true });
cpSync(`${pdf}/standard_fonts`, `${out}/standard_fonts`, { recursive: true });
console.log('done');
