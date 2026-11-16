import { verifyAudit } from '@pnote/core/audit';
import { applyCommand } from '@pnote/core/doc-state';
import type { Stroke } from '@pnote/core/types';
import { MemoryAdapter } from '@pnote/storage/adapter';
import { BackupReader, type BackupSink } from '@pnote/storage/backup';
import { exportDocument, exportProfile, importDocuments } from '@pnote/storage/backup-io';
import { BlobStore } from '@pnote/storage/blob-store';
import { __setKdfParamsForTest, generateDataKey } from '@pnote/storage/crypto';
import { EncryptedStore } from '@pnote/storage/encrypted-store';
import { Importer } from '@pnote/storage/importer';
import { Library } from '@pnote/storage/library';
import { readPdfInfo } from '../src/pdf-source';
import { plainPdf } from './fixtures/make-fixtures';

beforeAll(() => __setKdfParamsForTest({ memoryKiB: 1024 }));

const PW = 'backup-password-1';
const alice = { profileId: 'pA', name: 'อลิส' };
const bob = { profileId: 'pB', name: 'บ๊อบ' };
const style = { color: '#000', width: 2, opacity: 1, pressureCurve: 'normal' as const, taperStart: 0, taperEnd: 0, smoothing: 0.5 };

async function profile(who: { profileId: string; name: string }) {
  const store = new EncryptedStore(new MemoryAdapter(), await generateDataKey(), who.profileId);
  const lib = new Library(store, who);
  const blobs = new BlobStore(store);
  return { store, lib, blobs };
}

function memSink() {
  const parts: Uint8Array[] = [];
  const sink: BackupSink & { bytes(): Uint8Array } = {
    async write(b) { parts.push(b.slice()); }, async close() {}, async abort() { parts.length = 0; },
    bytes() { return new Uint8Array(Buffer.concat(parts)); },
  };
  return sink;
}
const src = (b: Uint8Array) => ({ size: b.length, slice: async (s: number, e: number) => b.slice(s, e) });

async function annotatedPdf(p: Awaited<ReturnType<typeof profile>>) {
  const imp = new Importer(p.lib, p.blobs, alice, { readPdfInfo, imageSize: async () => ({ w: 1, h: 1 }) });
  const bytes = await plainPdf(2, { padBytes: 1_500_000 });
  const meta = await imp.importPdf(Object.assign(new Blob([bytes as Uint8Array<ArrayBuffer>]), { name: 'สำนวน.pdf' }) as never, null);
  const { state, audit } = await p.lib.openDocument(meta.id);
  const stroke: Stroke = { id: 's1', pageId: meta.pages[0].id, tool: 'pen', style, points: new Float32Array([1, 2, 0.5, 0]), input: 'pen', author: alice, createdAt: 1 };
  const next = applyCommand(state, { type: 'addStroke', stroke });
  const { appendAudit } = await import('@pnote/core/audit');
  const audit2 = await appendAudit(audit, { time: 2, author: alice, action: 'stroke.add', objectIds: ['s1'] });
  await p.lib.saveDocument(meta, next, audit2, [meta.pages[0].id]);
  await p.lib.putTextLayer(meta.id, { pageId: meta.pages[1].id, engine: 'tesseract', lang: 'tha+eng', words: [{ text: 'ลับมาก', bbox: [1, 2, 3, 4], conf: 90 }], doneAt: 3 });
  return meta;
}

async function backupOf(p: Awaited<ReturnType<typeof profile>>, docId: string) {
  const sink = memSink();
  await exportDocument(p.lib, p.blobs, docId, sink, PW, alice);
  return sink.bytes();
}

describe('document .pnote', () => {
  it('moves a document with its source, ink, text layer and audit to another profile', async () => {
    const a = await profile(alice);
    const meta = await annotatedPdf(a);
    const file = await backupOf(a, meta.id);
    expect(new TextDecoder('latin1').decode(file)).not.toContain('สำนวน');
    expect(new TextDecoder('latin1').decode(file)).not.toContain('ลับมาก');

    const b = await profile(bob);
    const { imported: [got] } = await importDocuments(b.lib, b.blobs, await BackupReader.open(src(file), PW), bob, async () => 'copy');
    expect(got.id).toBe(meta.id); // no conflict: the id is kept
    const opened = await b.lib.openDocument(got.id);
    expect(opened.state.strokes[meta.pages[0].id].map((s) => s.id)).toEqual(['s1']);
    expect(opened.meta.sourceSha256).toBe(meta.sourceSha256);
    expect(await b.blobs.verify(`documents/${got.id}/source`)).toBe(true);
    expect((await b.lib.getTextLayer(got.id, meta.pages[1].id))?.words[0].text).toBe('ลับมาก');
    expect(await verifyAudit(opened.audit)).toEqual({ ok: true });
    expect(opened.audit.at(-1)).toMatchObject({ action: 'doc.import', profileName: 'บ๊อบ' });
    expect(opened.audit[0]).toMatchObject({ action: 'doc.import', profileName: 'อลิส' });
  });

  it('a second import: copy keeps both; replace hides the old one without deleting it', async () => {
    const a = await profile(alice);
    const meta = await annotatedPdf(a);
    const file = await backupOf(a, meta.id);
    const b = await profile(bob);
    await importDocuments(b.lib, b.blobs, await BackupReader.open(src(file), PW), bob, async () => 'copy');
    const { imported: [copy] } = await importDocuments(b.lib, b.blobs, await BackupReader.open(src(file), PW), bob, async () => 'copy');
    expect(copy.id).not.toBe(meta.id);
    expect(copy.originId).toBe(meta.id);
    expect((await b.lib.listDocuments(null)).length).toBe(2);
    const seen: string[] = [];
    const { imported: [rep] } = await importDocuments(b.lib, b.blobs, await BackupReader.open(src(file), PW), bob, async (existing) => { seen.push(existing.id); return 'replace'; });
    expect(seen).toEqual([meta.id]); // conflicts are found by id or origin id; the first match is asked about
    const listed = (await b.lib.listDocuments(null)).map((d) => d.id);
    expect(listed).toContain(rep.id);
    expect(listed).not.toContain(meta.id);
    expect((await b.lib.openDocument(meta.id)).meta.replacedBy).toBe(rep.id); // still on disk
    expect((await b.lib.listReplaced()).map((d) => d.id)).toEqual([meta.id]); // and reachable
    const old = await b.lib.openDocument(meta.id);
    expect(old.audit.at(-1)).toMatchObject({ action: 'doc.replace', objectIds: [meta.id, rep.id] });
    expect(old.auditOk).toBe(true);
  });

  it('a profile backup carries replaced documents and restores them still hidden', async () => {
    const a = await profile(alice);
    const meta = await annotatedPdf(a);
    const file = await backupOf(a, meta.id);
    const { imported: [rep] } = await importDocuments(a.lib, a.blobs, await BackupReader.open(src(file), PW), alice, async () => 'replace');
    const sink = memSink();
    await exportProfile(a.lib, a.blobs, sink, PW, alice);
    const b = await profile(bob);
    const got = await importDocuments(b.lib, b.blobs, await BackupReader.open(src(sink.bytes()), PW), bob, async () => 'copy');
    expect(got.imported.map((d) => d.id).sort()).toEqual([meta.id, rep.id].sort());
    expect((await b.lib.listDocuments(null)).map((d) => d.id)).toEqual([rep.id]);
    expect((await b.lib.listReplaced()).map((d) => [d.id, d.replacedBy])).toEqual([[meta.id, rep.id]]);
  });

  it('a file whose content does not match its manifest is not imported and leaves nothing behind', async () => {
    const a = await profile(alice);
    const meta = await annotatedPdf(a);
    const sink = memSink();
    await exportDocument(a.lib, a.blobs, meta.id, sink, PW, alice, { __corruptForTest: 'pages' });
    const b = await profile(bob);
    const got = await importDocuments(b.lib, b.blobs, await BackupReader.open(src(sink.bytes()), PW), bob, async () => 'copy');
    expect(got.imported).toEqual([]);
    expect(got.skipped).toEqual([meta.title]); // reported, not silently dropped
    expect(await b.lib.listDocuments(null)).toEqual([]);
    expect(await b.store.list('documents/')).toEqual([]);
  });
});

describe('profile .pnote', () => {
  it('restores folders, presets and every document into a new profile', async () => {
    const a = await profile(alice);
    const f = await a.lib.createFolder('คดี', null);
    const nb = await a.lib.createNotebook('บันทึก', f.id);
    const pdf = await annotatedPdf(a);
    await a.lib.savePresets([{ id: 'pr1', name: 'แดง', tool: 'pen', style }]);
    const sink = memSink();
    await exportProfile(a.lib, a.blobs, sink, PW, alice);
    const r = await BackupReader.open(src(sink.bytes()), PW);
    expect(r.header.kind).toBe('profile');
    const b = await profile(bob);
    const got = await importDocuments(b.lib, b.blobs, r, bob, async () => 'copy');
    expect(got.imported.map((d) => d.id).sort()).toEqual([nb.id, pdf.id].sort());
    expect((await b.lib.listFolders()).map((x) => x.name)).toEqual(['คดี']);
    expect((await b.lib.listDocuments(f.id)).map((d) => d.title)).toEqual(['บันทึก']);
    expect((await b.lib.listPresets()).map((p) => p.name)).toEqual(['แดง']);
  });
});
