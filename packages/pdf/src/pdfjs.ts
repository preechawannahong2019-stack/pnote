import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';

export type { PDFDocumentProxy };
export { pdfjs };

export interface PdfjsAssets { workerSrc?: string; cMapUrl?: string; standardFontDataUrl?: string; wasmUrl?: string }

let configured = false;
/** Point pdf.js at its worker (app-origin asset in the browser, the package file in Node). */
export function configurePdfjs(assets: PdfjsAssets = {}): void {
  if (assets.workerSrc) { pdfjs.GlobalWorkerOptions.workerSrc = assets.workerSrc; configured = true; return; }
  if (configured) return;
  if (typeof window === 'undefined') {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('../../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url).href;
  }
  configured = true;
}

export const RANGE_CHUNK = 1_048_576;

/** Open a PDF whose bytes are fetched on demand. */
export async function openRanged(read: (start: number, end: number) => Promise<Uint8Array>, size: number, assets: PdfjsAssets = {}): Promise<PDFDocumentProxy> {
  configurePdfjs(assets);
  const first = await read(0, Math.min(size, RANGE_CHUNK));
  const transport = new pdfjs.PDFDataRangeTransport(size, first);
  transport.requestDataRange = (begin: number, end: number) => {
    read(begin, end).then((chunk) => transport.onDataRange(begin, chunk), () => transport.abort());
  };
  return pdfjs.getDocument({
    range: transport,
    rangeChunkSize: RANGE_CHUNK,
    disableAutoFetch: true,
    disableStream: true,
    useSystemFonts: false,
    cMapUrl: assets.cMapUrl,
    cMapPacked: true,
    standardFontDataUrl: assets.standardFontDataUrl,
    wasmUrl: assets.wasmUrl,
    verbosity: 0,
  }).promise;
}
