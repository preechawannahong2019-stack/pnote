import type { OcrWord } from '@pnote/core/types';

export type { OcrWord };

export interface OcrEngine {
  /** Recognize words; bboxes are returned in page points. */
  recognize(image: CanvasImageSource, pageWidthPt: number): Promise<OcrWord[]>;
  terminate(): Promise<void>;
}

/** Tesseract.js reads <canvas>, not ImageBitmap/OffscreenCanvas: copy onto a plain canvas. */
export function toCanvas(image: CanvasImageSource): HTMLCanvasElement {
  if (typeof HTMLCanvasElement !== 'undefined' && image instanceof HTMLCanvasElement) return image;
  const src = image as { width: number; height: number };
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  c.getContext('2d')!.drawImage(image, 0, 0);
  return c;
}

export interface TesseractPaths { workerPath: string; corePath: string; langPath: string }

/** Tesseract (WASM, in a Web Worker) reading Thai + English, all assets from the app origin. */
export async function createTesseractEngine(paths: TesseractPaths): Promise<OcrEngine> {
  const { createWorker, OEM } = await import('tesseract.js');
  const worker = await createWorker('tha+eng', OEM.LSTM_ONLY, {
    workerPath: paths.workerPath,
    corePath: paths.corePath,
    langPath: paths.langPath,
    gzip: true,
    workerBlobURL: false,
    cacheMethod: 'none',
  });
  await worker.setParameters({ tessedit_pageseg_mode: '3' as never, preserve_interword_spaces: '1' });
  return {
    async recognize(image, pageWidthPt) {
      const canvas = toCanvas(image);
      const scale = pageWidthPt / (canvas.width || 1);
      const { data } = await worker.recognize(canvas as never, {}, { blocks: true });
      const out: OcrWord[] = [];
      for (const b of data.blocks ?? []) for (const p of b.paragraphs) for (const l of p.lines) for (const w of l.words) {
        if (!w.text.trim()) continue;
        out.push({ text: w.text, conf: w.confidence, bbox: [w.bbox.x0 * scale, w.bbox.y0 * scale, w.bbox.x1 * scale, w.bbox.y1 * scale] });
      }
      return out;
    },
    terminate: async () => { await worker.terminate(); },
  };
}
