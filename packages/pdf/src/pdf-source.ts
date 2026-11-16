import type { PdfPageBox } from '@pnote/core/types';
import type { BlobSource } from '@pnote/storage/blob-store';
import { openRanged, type PdfjsAssets } from './pdfjs';

export interface PdfPageInfo { pageNo: number; widthPt: number; heightPt: number; box: PdfPageBox }

export class PdfOpenError extends Error {
  constructor(readonly reason: 'password' | 'invalid', cause?: unknown) {
    super(reason === 'password' ? 'PDF is password protected' : 'PDF cannot be read');
    this.name = 'PdfOpenError';
    this.cause = cause;
  }
}

const round = (v: number) => Math.round(v * 100) / 100;

/** Page sizes, crop boxes and rotation of every page, reading only the bytes pdf.js needs. */
export async function readPdfInfo(src: BlobSource, assets: PdfjsAssets = {}): Promise<PdfPageInfo[]> {
  let doc;
  try {
    doc = await openRanged((s, e) => src.slice(s, e), src.size, assets);
  } catch (e) {
    throw new PdfOpenError((e as Error)?.name === 'PasswordException' ? 'password' : 'invalid', e);
  }
  try {
    const out: PdfPageInfo[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const [x1, y1, x2, y2] = page.view;
      const rotate = (((page.rotate % 360) + 360) % 360) as PdfPageBox['rotate'];
      const w = round(x2 - x1), h = round(y2 - y1);
      const turned = rotate === 90 || rotate === 270;
      out.push({ pageNo: n, widthPt: turned ? h : w, heightPt: turned ? w : h, box: { x: round(x1), y: round(y1), w, h, rotate } });
    }
    return out;
  } catch (e) {
    throw new PdfOpenError('invalid', e);
  } finally {
    await doc.loadingTask.destroy();
  }
}

export interface PdfWord { text: string; bbox: [number, number, number, number] }

type Render = ImageBitmap | HTMLCanvasElement | OffscreenCanvas;
export type RenderPurpose = 'view' | 'thumb' | 'ocr';

export const MAX_RENDER_WIDTH = 4096;
export const MAX_RENDER_PIXELS = 16_000_000;

/** Largest render width ≤ pixelWidth that keeps the canvas within 4096 px wide and 16 MP. */
export function clampRenderWidth(widthPt: number, heightPt: number, pixelWidth: number): number {
  const ratio = heightPt / widthPt;
  const byArea = Math.floor(Math.sqrt(MAX_RENDER_PIXELS / ratio));
  return Math.max(1, Math.min(pixelWidth, MAX_RENDER_WIDTH, byArea));
}

function free(r: Render): void {
  if ('close' in r && typeof r.close === 'function') r.close();
  else { (r as HTMLCanvasElement).width = 0; (r as HTMLCanvasElement).height = 0; }
}

/** A lazily-read PDF: renders pages and extracts text in page space. */
export class PdfDocumentSource {
  private cache = new Map<string, Promise<Render>>();
  private side = new Map<string, Promise<Render>>();
  private static readonly CACHE = 5;
  private static readonly SIDE_CACHE = 2;

  private constructor(private doc: import('./pdfjs').PDFDocumentProxy) {}

  static async open(read: (start: number, end: number) => Promise<Uint8Array>, size: number, assets: PdfjsAssets = {}): Promise<PdfDocumentSource> {
    try {
      return new PdfDocumentSource(await openRanged(read, size, assets));
    } catch (e) {
      throw new PdfOpenError((e as Error)?.name === 'PasswordException' ? 'password' : 'invalid', e);
    }
  }

  get pageCount(): number { return this.doc.numPages; }

  async pageWords(pageNo: number): Promise<PdfWord[]> {
    const page = await this.doc.getPage(pageNo);
    const vp = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const out: PdfWord[] = [];
    for (const item of content.items as { str?: string; transform?: number[]; width?: number; height?: number }[]) {
      if (!item.str?.trim() || !item.transform) continue;
      const [, , , , e, f] = item.transform;
      const h = item.height || Math.hypot(item.transform[2], item.transform[3]);
      const [ax, ay] = vp.convertToViewportPoint(e, f);
      const [bx, by] = vp.convertToViewportPoint(e + (item.width ?? 0), f + h);
      out.push({ text: item.str, bbox: [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)] });
    }
    return out;
  }

  /**
   * Render a page about `pixelWidth` wide (bucketed to 256 px, clamped to 4096 px / 16 MP so iOS canvases
   * never go blank). 'view' renders live in an LRU of 5; thumbnails and OCR renders use a separate LRU of 2
   * so they never evict the page on screen. Evicted canvases are shrunk to free their memory at once.
   */
  async render(pageNo: number, pixelWidth: number, purpose: RenderPurpose = 'view'): Promise<Render> {
    const page = await this.doc.getPage(pageNo);
    const [x1, y1, x2, y2] = page.view;
    const turned = ((page as { rotate?: number }).rotate ?? 0) % 180 !== 0;
    const [wPt, hPt] = turned ? [y2 - y1, x2 - x1] : [x2 - x1, y2 - y1];
    const bucket = Math.max(256, Math.ceil(pixelWidth / 256) * 256);
    const width = clampRenderWidth(wPt, hPt, bucket);
    const cache = purpose === 'view' ? this.cache : this.side;
    const limit = purpose === 'view' ? PdfDocumentSource.CACHE : PdfDocumentSource.SIDE_CACHE;
    const key = `${pageNo}:${width}`;
    const hit = cache.get(key);
    if (hit) {
      cache.delete(key);
      cache.set(key, hit);
      return hit;
    }
    const p = this.draw(pageNo, width);
    cache.set(key, p);
    p.catch(() => cache.delete(key));
    while (cache.size > limit) {
      const oldest = cache.keys().next().value!;
      const evicted = cache.get(oldest);
      cache.delete(oldest);
      void evicted?.then(free, () => {});
    }
    return p;
  }

  private async draw(pageNo: number, width: number): Promise<Render> {
    const page = await this.doc.getPage(pageNo);
    const base = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: width / base.width });
    const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(Math.ceil(vp.width), Math.ceil(vp.height)) : Object.assign(document.createElement('canvas'), { width: Math.ceil(vp.width), height: Math.ceil(vp.height) });
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas: canvas as HTMLCanvasElement, canvasContext: ctx, viewport: vp }).promise;
    return canvas;
  }

  prefetch(pageNos: number[], pixelWidth: number): void {
    for (const n of pageNos) if (n >= 1 && n <= this.pageCount) this.render(n, pixelWidth, 'view').catch(() => {});
  }

  async destroy(): Promise<void> {
    for (const c of [this.cache, this.side]) { for (const p of c.values()) void p.then(free, () => {}); c.clear(); }
    await this.doc.loadingTask.destroy();
  }
}
