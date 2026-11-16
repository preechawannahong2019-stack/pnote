// Fails when the built web app references any external http(s) origin.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIST = new URL('../apps/web/dist/', import.meta.url).pathname;
const ALLOW = [
  // tesseract.js built-in CDN defaults: the app always passes local workerPath/corePath/langPath, and CSP blocks other origins
  /^https:\/\/cdn\.jsdelivr\.net\/npm\/(tesseract\.js|tesseract\.js-core|@tesseract\.js-data)[@/]/,
  // URL feature-detection literals in a bundled polyfill (never fetched)
  /^https?:\/\/(a|x|foo\.bar|example\.com|тест|\$\{n\})([\/@#?]|$)/,
  /^https?:\/\/www\.w3\.org\//,      // XML/SVG namespaces
  /^https?:\/\/(localhost|127\.0\.0\.1)/,
  /^https?:\/\/github\.com\/[\w-]+\/[\w.-]+\/?(issues|blob)?/i, // library error/license comments
  /^https?:\/\/www\.npmjs\.com\/package\//, // hash-wasm error message text (never fetched)
  /^https?:\/\/(svelte\.dev|developer\.mozilla\.org|goo\.gl|bit\.ly|reactjs\.org|capacitorjs\.com)\//, // doc links in error messages
  /^https:\/\/\$\{\w+\}$/, // web capture: a page address the user typed, given a scheme (opened only in the capture window)
];
const URL_RE = /https?:\/\/[^\s"'`)<>\\]+/g;

function* files(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (/\.(js|html|css|webmanifest|json)$/.test(f)) yield p;
  }
}

let bad = 0;
for (const file of files(DIST)) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const m of line.matchAll(URL_RE)) {
      if (!ALLOW.some((r) => r.test(m[0]))) {
        console.log(`${file.replace(DIST, 'dist/')}:${i + 1}: ${m[0]}`);
        bad++;
      }
    }
  });
}
if (bad) { console.error(`\n${bad} external URL(s) found`); process.exit(1); }
console.log('no external URLs');
