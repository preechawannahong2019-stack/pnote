import { appendAudit } from '@pnote/core/audit';
import { newId } from '@pnote/core/ids';
import { A4, type Author, type DocumentMeta, type Id, type PageRef, type PdfPageBox } from '@pnote/core/types';
import { BlobStore, fileSource, type BlobSource } from './blob-store';
import type { Library } from './library';

export type ImportError = 'not-pdf' | 'password' | 'corrupt' | 'unsupported-image' | 'too-large';

export class ImportFailed extends Error {
  constructor(readonly code: ImportError, cause?: unknown) {
    super(`import failed: ${code}`);
    this.name = 'ImportFailed';
    this.cause = cause;
  }
}

export const MAX_IMPORT_BYTES = 1_073_741_824;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

type PdfInfo = { pageNo: number; widthPt: number; heightPt: number; box: PdfPageBox }[];
type ImportFile = Blob & { name: string };

export interface ImporterDeps {
  readPdfInfo: (src: BlobSource) => Promise<PdfInfo>;
  imageSize: (src: BlobSource, mime: string) => Promise<{ w: number; h: number }>;
  now?: () => number;
}

const baseName = (name: string) => name.replace(/\.[^./\\]+$/, '') || name;

export class Importer {
  private now: () => number;

  constructor(private lib: Library, private blobs: BlobStore, private author: Author, private deps: ImporterDeps) {
    this.now = deps.now ?? (() => Date.now());
  }

  private async store(meta: DocumentMeta, src: BlobSource, mime: string, onProgress?: (p: number) => void): Promise<DocumentMeta> {
    const rel = `documents/${meta.id}/source`;
    try {
      const m = await this.blobs.put(rel, src, mime, (d, t) => onProgress?.(t ? d / t : 1));
      const full: DocumentMeta = { ...meta, sourceBlobId: 'source', sourceSha256: m.sha256 };
      const audit = await appendAudit([], { time: meta.importedAt!, author: this.author, action: 'doc.import', objectIds: [meta.id] });
      await this.lib.commitImport(full, audit); // meta written last
      return full;
    } catch (e) {
      await this.lib.removeDocumentFiles(meta.id).catch(() => {});
      throw e;
    }
  }

  async importPdf(file: ImportFile, folderId: Id | null, onProgress?: (p: number) => void): Promise<DocumentMeta> {
    if (file.size > MAX_IMPORT_BYTES) throw new ImportFailed('too-large');
    const src = fileSource(file);
    const head = new TextDecoder('latin1').decode(await src.slice(0, Math.min(1024, file.size)));
    if (!head.includes('%PDF-')) throw new ImportFailed('not-pdf');
    let info: PdfInfo;
    try {
      info = await this.deps.readPdfInfo(src);
    } catch (e) {
      throw new ImportFailed((e as { reason?: string })?.reason === 'password' ? 'password' : 'corrupt', e);
    }
    if (!info.length) throw new ImportFailed('corrupt');
    const t = this.now();
    const pages: PageRef[] = info.map((p) => ({ id: newId(), source: { type: 'pdf', pageNo: p.pageNo }, widthPt: p.widthPt, heightPt: p.heightPt, pdfBox: p.box }));
    const meta: DocumentMeta = {
      id: newId(), profileId: this.lib.profileId, folderId, title: baseName(file.name), kind: 'pdf',
      originalName: file.name, importedAt: t, pages, createdAt: t, updatedAt: t,
    };
    return this.store(meta, src, 'application/pdf', onProgress);
  }

  async importImage(file: ImportFile, folderId: Id | null): Promise<DocumentMeta> {
    if (file.size > MAX_IMPORT_BYTES) throw new ImportFailed('too-large');
    const mime = file.type || 'application/octet-stream';
    if (!IMAGE_TYPES.includes(mime)) throw new ImportFailed('unsupported-image');
    const src = fileSource(file);
    let size: { w: number; h: number };
    try {
      size = await this.deps.imageSize(src, mime);
    } catch (e) {
      throw new ImportFailed('unsupported-image', e);
    }
    if (!(size.w > 0 && size.h > 0)) throw new ImportFailed('unsupported-image');
    const t = this.now();
    const widthPt = A4.widthPt;
    const heightPt = Math.round(((A4.widthPt * size.h) / size.w) * 100) / 100;
    const meta: DocumentMeta = {
      id: newId(), profileId: this.lib.profileId, folderId, title: baseName(file.name), kind: 'image',
      originalName: file.name, importedAt: t,
      pages: [{ id: newId(), source: { type: 'image', blobId: 'source' }, widthPt, heightPt }],
      createdAt: t, updatedAt: t,
    };
    return this.store(meta, src, mime);
  }
}
