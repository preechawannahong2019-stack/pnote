import type { Id, OcrPage, OcrWord, PageRef } from '@pnote/core/types';
import type { Library } from '@pnote/storage/library';
import type { OcrEngine } from './ocr';

export type { OcrEngine, OcrWord };

export const MIN_PDF_TEXT_CHARS = 20;
export const OCR_SCALE = 2;          // render at 2 px per pt (≈ 144 dpi)
export const OCR_MAX_PX = 3000;

export interface OcrQueueDeps {
  lib: Library;
  docId: Id;
  pages: PageRef[];
  render: (page: PageRef, pixelWidth: number) => Promise<CanvasImageSource | null>;
  pdfWords: (pageNo: number) => Promise<OcrWord[]>;
  engine: () => Promise<OcrEngine>;
  now?: () => number;
}

const yieldToUi = () => new Promise<void>((r) => setTimeout(r, 0));

/** Builds a text layer for every page that lacks one, one page at a time; resumable. */
export class OcrQueue {
  private running: Promise<void> | null = null;
  private stopped = false;
  private progress = new Set<(done: number, total: number) => void>();
  private errors = new Set<(e: unknown, page: PageRef) => void>();
  private engine: OcrEngine | null = null;

  constructor(private deps: OcrQueueDeps) {}

  onProgress(cb: (done: number, total: number) => void): () => void { this.progress.add(cb); return () => this.progress.delete(cb); }
  onError(cb: (e: unknown, page: PageRef) => void): () => void { this.errors.add(cb); return () => this.errors.delete(cb); }

  start(): void {
    if (this.running) return;
    this.stopped = false;
    this.running = this.loop().finally(() => { this.running = null; });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    await this.running?.catch(() => {});
    await this.engine?.terminate().catch(() => {});
    this.engine = null;
  }

  private async loop(): Promise<void> {
    const { lib, docId, pages } = this.deps;
    const have = await lib.textLayerIds(docId);
    const todo = pages.filter((p) => p.source.type !== 'blank' && !have.has(p.id));
    let done = 0;
    if (!todo.length) { this.progress.forEach((cb) => cb(0, 0)); return; }
    for (const page of todo) {
      if (this.stopped) return;
      try {
        await lib.putTextLayer(docId, await this.layerFor(page));
      } catch (e) {
        this.errors.forEach((cb) => cb(e, page));
      }
      done++;
      this.progress.forEach((cb) => cb(done, todo.length));
      await yieldToUi();
    }
    await this.engine?.terminate().catch(() => {});
    this.engine = null;
  }

  private async layerFor(page: PageRef): Promise<OcrPage> {
    const now = this.deps.now ?? (() => Date.now());
    if (page.source.type === 'pdf') {
      const words = await this.deps.pdfWords(page.source.pageNo);
      const chars = words.reduce((n, w) => n + w.text.replace(/\s/g, '').length, 0);
      if (chars >= MIN_PDF_TEXT_CHARS) return { pageId: page.id, engine: 'pdf-text', lang: 'tha+eng', words, doneAt: now() };
    }
    const px = Math.min(OCR_MAX_PX, Math.round(page.widthPt * OCR_SCALE));
    const image = await this.deps.render(page, px);
    if (!image) throw new Error('nothing to read');
    this.engine ??= await this.deps.engine();
    const words = await this.engine.recognize(image, page.widthPt);
    return { pageId: page.id, engine: 'tesseract', lang: 'tha+eng', words, doneAt: now() };
  }
}
