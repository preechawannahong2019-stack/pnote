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
