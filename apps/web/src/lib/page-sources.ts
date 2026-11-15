import type { DocumentMeta, PageRef } from '@pnote/core/types';
import type { PdfjsAssets } from '@pnote/pdf/pdfjs';
import { PdfDocumentSource, type RenderPurpose } from '@pnote/pdf/pdf-source';

export const PREFETCH_MAX_WIDTH = 1536;
import type { BlobStore } from '@pnote/storage/blob-store';

export const PDFJS_ASSETS: PdfjsAssets = {
  workerSrc: './vendor/pdfjs/pdf.worker.min.mjs',
  cMapUrl: './vendor/pdfjs/cmaps/',
  standardFontDataUrl: './vendor/pdfjs/standard_fonts/',
  wasmUrl: './vendor/pdfjs/wasm/',
};

type Doc = Pick<PdfDocumentSource, 'render' | 'prefetch' | 'destroy' | 'pageWords'>;
type Open = (read: (s: number, e: number) => Promise<Uint8Array>, size: number, assets?: PdfjsAssets) => Promise<Doc>;

const SOURCE = (meta: DocumentMeta) => `documents/${meta.id}/source`;

/** Backgrounds (PDF renders, decoded images) for one open document. */
export class PageSources {
  private pdf: Promise<Doc> | null = null;
  private image: Promise<ImageBitmap | HTMLImageElement> | null = null;

  constructor(private meta: DocumentMeta, private blobs: BlobStore, private open: Open = PdfDocumentSource.open as Open) {}

  pdfDoc(): Promise<Doc> {
    if (!this.pdf) {
      this.pdf = (async () => {
        const m = await this.blobs.manifest(SOURCE(this.meta));
        if (!m) throw new Error('source missing');
        return this.open((s, e) => this.blobs.readRange(SOURCE(this.meta), s, e), m.size, PDFJS_ASSETS);
      })();
    }
    return this.pdf;
  }

  private async decodeImage(): Promise<ImageBitmap | HTMLImageElement> {
    const m = await this.blobs.manifest(SOURCE(this.meta));
    const bytes = await this.blobs.readAll(SOURCE(this.meta));
    const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: m?.mime ?? 'image/jpeg' });
    if (typeof createImageBitmap === 'function') {
      try { return await createImageBitmap(blob); } catch { /* fall back to <img> (e.g. HEIC on Safari) */ }
    }
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async background(page: PageRef, pixelWidth: number, purpose: RenderPurpose = 'view'): Promise<CanvasImageSource | null> {
    if (page.source.type === 'pdf') return (await this.pdfDoc()).render(page.source.pageNo, pixelWidth, purpose) as Promise<CanvasImageSource>;
    if (page.source.type === 'image') return (this.image ??= this.decodeImage());
    return null;
  }

  async prefetchAround(index: number, pixelWidth: number): Promise<void> {
    if (this.meta.kind !== 'pdf') return;
    const nos = this.meta.pages.slice(Math.max(0, index - 2), index + 3)
      .map((p) => (p.source.type === 'pdf' ? p.source.pageNo : 0)).filter(Boolean);
    // neighbours at a fit-page resolution, not at the current zoom
    (await this.pdfDoc()).prefetch(nos, Math.min(pixelWidth, PREFETCH_MAX_WIDTH));
  }

  async destroy(): Promise<void> {
    if (this.pdf) await (await this.pdf.catch(() => null))?.destroy();
    const img = await this.image?.catch(() => null);
    if (img && 'close' in img) img.close();
  }
}

/**
 * Background to draw for the wanted `pageId:width` key: the current render when it is of the same page
 * (possibly at the old zoom — blurry beats blank while the sharper one renders), never another page's.
 */
export function backgroundFor(current: { key: string; img: CanvasImageSource } | null, want: string): CanvasImageSource | null {
  if (!current || !want) return null;
  return current.key.split(':')[0] === want.split(':')[0] ? current.img : null;
}
