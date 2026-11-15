// Copies runtime assets that libraries load by URL into apps/web/public/vendor (served from the app origin, precached).
import { cpSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const nm = join(root, 'node_modules');
const out = join(root, 'apps/web/public/vendor');
rmSync(out, { recursive: true, force: true });

const copies = [
  ['pdfjs-dist/legacy/build/pdf.worker.min.mjs', 'pdfjs/pdf.worker.min.mjs'],
  ['pdfjs-dist/cmaps', 'pdfjs/cmaps'],
  ['pdfjs-dist/standard_fonts', 'pdfjs/standard_fonts'],
  ['pdfjs-dist/wasm', 'pdfjs/wasm'],
  ['tesseract.js/dist/worker.min.js', 'tesseract/worker.min.js'],
  ['tesseract.js-core', 'tesseract/core', (p) => /-lstm\.wasm\.js$/.test(p) || p === '/LICENSE' || p === ''],
  ['@tesseract.js-data/tha/4.0.0_best_int/tha.traineddata.gz', 'tesseract/lang/tha.traineddata.gz'],
  ['@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'tesseract/lang/eng.traineddata.gz'],
  ['@fontsource/sarabun/files', 'fonts', (p) => p === '' || /^\/sarabun-(thai|latin)-(400|700)-normal\.woff$/.test(p)],
];
for (const [from, to, filter] of copies) {
  const src = join(nm, from);
  if (!existsSync(src)) { console.warn(`skip (not installed yet): ${from}`); continue; }
  mkdirSync(dirname(join(out, to)), { recursive: true });
  cpSync(src, join(out, to), { recursive: true, filter: filter ? (p) => filter(p.slice(src.length)) : undefined });
}
console.log('assets copied to apps/web/public/vendor');
