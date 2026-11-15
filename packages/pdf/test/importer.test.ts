import { sha256Hex } from '@pnote/core/hash';
import { MemoryAdapter } from '@pnote/storage/adapter';
import { BlobStore, type BlobSource } from '@pnote/storage/blob-store';
import { generateDataKey } from '@pnote/storage/crypto';
import { EncryptedStore } from '@pnote/storage/encrypted-store';
import { ImportFailed, Importer } from '@pnote/storage/importer';
import { Library } from '@pnote/storage/library';
import { readPdfInfo } from '../src/pdf-source';
import { brokenPdf, croppedPdf, encryptedPdf, notPdf, plainPdf, rotatedPdf } from './fixtures/make-fixtures';

const author = { profileId: 'p1', name: 'A' };
const asFile = (b: Uint8Array, name: string, type = 'application/pdf') =>
  Object.assign(new Blob([b as Uint8Array<ArrayBuffer>], { type }), { name });

async function setup(imageSize = async (_s: BlobSource, _m: string) => ({ w: 1000, h: 500 })) {
  const store = new EncryptedStore(new MemoryAdapter(), await generateDataKey(), 'p1');
  const lib = new Library(store, author, () => 1000);
  const imp = new Importer(lib, new BlobStore(store), author, { readPdfInfo, imageSize, now: () => 1000 });
  return { store, lib, imp };
}

async function expectNothingStored(lib: Library, store: EncryptedStore) {
  expect(await lib.listDocuments(null)).toEqual([]);
  expect(await store.list('documents/')).toEqual([]);
}

describe('Importer.importPdf', () => {
  it('imports a 3-page PDF with evidence fields and audit', async () => {
    const { lib, imp } = await setup();
    const bytes = await plainPdf(3);
    const meta = await imp.importPdf(asFile(bytes, 'คำให้การ.pdf'), null);
    expect(meta).toMatchObject({ kind: 'pdf', title: 'คำให้การ', originalName: 'คำให้การ.pdf', importedAt: 1000, sourceSha256: await sha256Hex(bytes) });
    expect(meta.pages.map((p) => p.source)).toEqual([1, 2, 3].map((n) => ({ type: 'pdf', pageNo: n })));
    expect(meta.pages[0]).toMatchObject({ widthPt: 595.28, heightPt: 841.89 });
    const opened = await lib.openDocument(meta.id);
    expect(opened.audit.map((a) => a.action)).toEqual(['doc.import']);
    expect(opened.auditOk).toBe(true);
    expect((await lib.listDocuments(null)).map((d) => d.id)).toEqual([meta.id]);
  });

  it('swaps width and height for a rotated page', async () => {
    const { imp } = await setup();
    const meta = await imp.importPdf(asFile(await rotatedPdf(), 'r.pdf'), null);
    expect(meta.pages[0]).toMatchObject({ widthPt: 841.89, heightPt: 595.28 });
    expect(meta.pages[0].pdfBox?.rotate).toBe(90);
  });

  it('uses the crop box', async () => {
    const { imp } = await setup();
    const meta = await imp.importPdf(asFile(await croppedPdf(), 'c.pdf'), null);
    expect(meta.pages[0]).toMatchObject({ widthPt: 350, heightPt: 440 });
    expect(meta.pages[0].pdfBox).toEqual({ x: 50, y: 60, w: 350, h: 440, rotate: 0 });
  });

  it.each([
    ['not-pdf', () => notPdf()],
    ['corrupt', () => brokenPdf()],
    ['password', () => encryptedPdf()],
  ] as const)('rejects %s and stores nothing', async (code, make) => {
    const { lib, store, imp } = await setup();
    const err = await imp.importPdf(asFile(await make(), 'x.pdf'), null).catch((e) => e);
    expect(err).toBeInstanceOf(ImportFailed);
    expect(err.code).toBe(code);
    await expectNothingStored(lib, store);
  });

  it('cleans up after a crash before the meta was written', async () => {
    const { lib, store, imp } = await setup();
    // the app is killed: meta never written and the importer's own cleanup never runs
    vi.spyOn(lib as unknown as { putMeta: () => Promise<void> }, 'putMeta').mockRejectedValueOnce(new Error('crash'));
    vi.spyOn(lib, 'removeDocumentFiles').mockResolvedValueOnce();
    await expect(imp.importPdf(asFile(await plainPdf(1), 'a.pdf'), null)).rejects.toThrow('crash');
    expect(await lib.cleanupOrphans()).toBe(1);
    await expectNothingStored(lib, store);
  });
});

describe('Importer.importImage', () => {
  it('makes one A4-wide page with the image aspect ratio', async () => {
    const { imp } = await setup();
    const meta = await imp.importImage(asFile(new Uint8Array([1, 2, 3]), 'scan.jpg', 'image/jpeg'), null);
    expect(meta.kind).toBe('image');
    expect(meta.pages).toHaveLength(1);
    expect(meta.pages[0].widthPt).toBeCloseTo(595.28);
    expect(meta.pages[0].heightPt).toBeCloseTo(297.64);
    expect(meta.pages[0].source.type).toBe('image');
  });

  it('rejects an image the browser cannot decode', async () => {
    const { lib, store, imp } = await setup(async () => { throw new Error('cannot decode'); });
    const err = await imp.importImage(asFile(new Uint8Array([1]), 'p.heic', 'image/heic'), null).catch((e) => e);
    expect(err.code).toBe('unsupported-image');
    await expectNothingStored(lib, store);
  });
});
