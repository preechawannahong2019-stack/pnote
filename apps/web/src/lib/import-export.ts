import type { Author, DocumentMeta, Id, OcrPage } from '@pnote/core/types';
import { exportPdf, type ExportOptions } from '@pnote/pdf/export';
import { loadExportFonts } from '@pnote/pdf/fonts';
import { readPdfInfo } from '@pnote/pdf/pdf-source';
import { BlobStore, type BlobSource } from '@pnote/storage/blob-store';
import { ImportFailed, Importer, type ImportError } from '@pnote/storage/importer';
import type { Library } from '@pnote/storage/library';
import { PDFJS_ASSETS } from './page-sources';

export const IMPORT_MESSAGES: Record<ImportError, string> = {
  'not-pdf': 'ไฟล์นี้ไม่ใช่ PDF',
  password: 'PDF นี้มีรหัสผ่าน กรุณาปลดรหัสก่อนนำเข้า',
  corrupt: 'ไฟล์ PDF เสียหาย เปิดไม่ได้',
  'unsupported-image': 'เปิดรูปภาพชนิดนี้ไม่ได้ในเบราว์เซอร์นี้',
  'too-large': 'ไฟล์ใหญ่เกิน 1 GB',
};

async function imageSize(src: BlobSource, mime: string): Promise<{ w: number; h: number }> {
  const bytes = await src.slice(0, src.size);
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime });
  const bmp = await createImageBitmap(blob);
  const out = { w: bmp.width, h: bmp.height };
  bmp.close();
  return out;
}

export function makeImporter(lib: Library, blobs: BlobStore, author: Author): Importer {
  return new Importer(lib, blobs, author, { readPdfInfo: (src) => readPdfInfo(src, PDFJS_ASSETS), imageSize });
}

export const isPdf = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);

/** Import one file; returns the new document or a Thai error message. */
export async function importFile(imp: Importer, f: File, folderId: Id | null, onProgress?: (p: number) => void): Promise<DocumentMeta | string> {
  try {
    return isPdf(f) ? await imp.importPdf(f, folderId, onProgress) : await imp.importImage(f, folderId);
  } catch (e) {
    if (e instanceof ImportFailed) return IMPORT_MESSAGES[e.code];
    return 'นำเข้าไม่สำเร็จ';
  }
}

export function exportFileName(title: string, at = new Date()): string {
  const d = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
  return `${title.replace(/[\\/:*?"<>|]/g, '_').trim() || 'document'}_${d}.pdf`;
}

/** Re-encode an image the PDF writer cannot embed (WebP, HEIC) as PNG. */
async function toPdfImage(bytes: Uint8Array, mime: string): Promise<{ bytes: Uint8Array; mime: string }> {
  if (mime === 'image/jpeg' || mime === 'image/png') return { bytes, mime };
  const bmp = await createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime }));
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  c.getContext('2d')!.drawImage(bmp, 0, 0);
  bmp.close();
  return { bytes: new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer()), mime: 'image/png' };
}

export async function buildExport(lib: Library, blobs: BlobStore, docId: Id, by: Author, opts: ExportOptions): Promise<{ bytes: Uint8Array; name: string }> {
  const { meta, state, audit } = await lib.openDocument(docId);
  const rel = `documents/${meta.id}/source`;
  const manifest = meta.kind === 'notebook' ? null : await blobs.manifest(rel);
  const source = meta.kind === 'pdf' && manifest ? await blobs.readAll(rel) : null;
  const images: Record<Id, { bytes: Uint8Array; mime: string }> = {};
  if (meta.kind === 'image' && manifest) {
    const img = await toPdfImage(await blobs.readAll(rel), manifest.mime);
    for (const p of meta.pages) if (p.source.type === 'image') images[p.id] = img;
  }
  const textLayers: Record<Id, OcrPage> = {};
  if (opts.includeTextLayer) for (const p of meta.pages) { const l = await lib.getTextLayer(meta.id, p.id); if (l) textLayers[p.id] = l; }
  const sourceIntact = manifest ? await blobs.verify(rel) : null;
  const bytes = await exportPdf({ meta, state, audit, source, images, textLayers, sourceIntact, exportedAt: Date.now(), exportedBy: by, fonts: await loadExportFonts() }, opts);
  return { bytes, name: exportFileName(meta.title) };
}
