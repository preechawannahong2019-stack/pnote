import { appendAudit, type AuditEntry } from '@pnote/core/audit';
import { sha256Hex } from '@pnote/core/hash';
import { newId } from '@pnote/core/ids';
import type { Author, DocumentMeta, Folder, Id, PenPreset } from '@pnote/core/types';
import { BackupReader, BackupWriter, type BackupSink, type EntrySink } from './backup';
import type { BlobManifest, BlobStore } from './blob-store';
import { MAX_PRESETS, type Library } from './library';

/** Inside the encrypted stream:
 *   profile/folders.json, profile/presets.json                (profile backups)
 *   documents/<id>/meta.json, audit.json, blobs.json          (blobs.json: [{ rel, mime }])
 *   documents/<id>/files/<rel>                                (meta-less store files: pages, text layers, capture.json, …)
 *   documents/<id>/blobs/<rel>                                (reassembled blobs: source, capture/screenshot, …)
 *   manifest.json                                             (last: SHA-256 and size of every file above)
 */
export interface BackupManifest {
  kind: 'document' | 'profile'; exportedAt: number; exportedBy: string; appVersion: string;
  documents: { id: Id; title: string; files: { path: string; sha256: string; bytes: number }[] }[];
}
export type ConflictChoice = 'copy' | 'replace';
/** `skipped`: titles of documents that failed the integrity check and were not imported. */
export interface ImportResult { imported: DocumentMeta[]; skipped: string[] }
const APP_VERSION = '0.3.0';
const enc = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));

async function writeDocument(lib: Library, blobs: BlobStore, w: BackupWriter, meta: DocumentMeta, corrupt?: string) {
  const store = lib.backupAccess();
  const dir = `documents/${meta.id}/`;
  const paths = (await store.list(dir)).map((p) => p.slice(dir.length));
  const blobRels = paths.filter((p) => p.endsWith('/manifest.json')).map((p) => p.slice(0, -'/manifest.json'.length));
  const inBlob = (p: string) => blobRels.some((b) => p.startsWith(`${b}/`));
  const plain = paths.filter((p) => p !== 'meta.json' && p !== 'audit.json' && !inBlob(p));
  const files: BackupManifest['documents'][number]['files'] = [];
  const add = async (path: string, bytes: Uint8Array) => {
    await w.addFile(path, bytes);
    files.push({ path, sha256: corrupt && path.includes(corrupt) ? '0'.repeat(64) : await sha256Hex(bytes), bytes: bytes.length });
  };
  await add(`${dir}meta.json`, (await store.getBytes(`${dir}meta.json`))!);
  await add(`${dir}audit.json`, (await store.getBytes(`${dir}audit.json`)) ?? enc([]));
  const manifests: Record<string, BlobManifest> = {};
  for (const rel of blobRels) manifests[rel] = (await blobs.manifest(`${dir}${rel}`))!;
  await add(`${dir}blobs.json`, enc(blobRels.map((rel) => ({ rel, mime: manifests[rel].mime }))));
  for (const rel of plain) await add(`${dir}files/${rel}`, (await store.getBytes(`${dir}${rel}`))!);
  for (const rel of blobRels) {
    const m = manifests[rel];
    const path = `${dir}blobs/${rel}`;
    await w.addFile(path, { size: m.size, slice: (s: number, e: number) => blobs.readRange(`${dir}${rel}`, s, e) });
    files.push({ path, sha256: m.sha256, bytes: m.size });
  }
  return { id: meta.id, title: meta.title, files };
}

export async function exportDocument(lib: Library, blobs: BlobStore, docId: Id, sink: BackupSink, password: string, by: Author,
  test?: { __corruptForTest?: string }): Promise<void> {
  const w = await BackupWriter.create(sink, 'document', password);
  try {
    const { meta } = await lib.openDocument(docId);
    const doc = await writeDocument(lib, blobs, w, meta, test?.__corruptForTest);
    const manifest: BackupManifest = { kind: 'document', exportedAt: Date.now(), exportedBy: by.name, appVersion: APP_VERSION, documents: [doc] };
    await w.addFile('manifest.json', enc(manifest));
    await w.close();
  } catch (e) {
    await w.abort();
    throw e;
  }
}

export async function exportProfile(lib: Library, blobs: BlobStore, sink: BackupSink, password: string, by: Author,
  onProgress?: (done: number, total: number) => void): Promise<void> {
  const w = await BackupWriter.create(sink, 'profile', password);
  try {
    await w.addFile('profile/folders.json', enc(await lib.listFolders()));
    await w.addFile('profile/presets.json', enc(await lib.listPresets()));
    const docs = await lib.allDocumentsIncludingReplaced(); // replaced (hidden) documents are evidence too
    const out: BackupManifest['documents'] = [];
    for (let i = 0; i < docs.length; i++) {
      out.push(await writeDocument(lib, blobs, w, docs[i]));
      onProgress?.(i + 1, docs.length);
    }
    await w.addFile('manifest.json', enc({ kind: 'profile', exportedAt: Date.now(), exportedBy: by.name, appVersion: APP_VERSION, documents: out } satisfies BackupManifest));
    await w.close();
  } catch (e) {
    await w.abort();
    throw e;
  }
}

interface Pending {
  meta?: DocumentMeta; audit?: AuditEntry[]; blobs?: { rel: string; mime: string }[];
  target?: Id; replace?: Id; ready: Promise<void>; written: Map<string, { sha256: string; bytes: number }>;
}

function collect(onDone: (b: Uint8Array) => Promise<void>): EntrySink {
  const parts: Uint8Array[] = [];
  let n = 0;
  return {
    write: async (c) => { parts.push(c); n += c.length; },
    end: async () => { const b = new Uint8Array(n); let o = 0; for (const p of parts) { b.set(p, o); o += p.length; } await onDone(b); },
  };
}

/**
 * Imports every document of a .pnote (document or profile backup). Per document: files are written under the
 * target id as they stream in, checked against manifest.json at the end, and the meta is written last; a document
 * that fails the check is removed. A conflicting id (same id, or same origin id) asks `choose`: 'copy' keeps both,
 * 'replace' hides the existing one (its files stay). The incoming copy takes a new id only when there is a conflict.
 */
export async function importDocuments(lib: Library, blobs: BlobStore, reader: BackupReader, by: Author,
  choose: (existing: DocumentMeta, incoming: { id: Id; title: string }) => Promise<ConflictChoice>): Promise<ImportResult> {
  const store = lib.backupAccess();
  const docs = new Map<string, Pending>();
  let manifest: BackupManifest | null = null;
  let folders: Folder[] = [];
  let presets: PenPreset[] = [];
  const doc = (id: string) => { let d = docs.get(id); if (!d) { d = { ready: Promise.resolve(), written: new Map() }; docs.set(id, d); } return d; };
  const json = <T>(b: Uint8Array) => JSON.parse(new TextDecoder().decode(b)) as T;

  const decide = async (d: Pending, meta: DocumentMeta) => {
    if (meta.replacedBy) { d.target = (await store.getJSON(`documents/${meta.id}/meta.json`)) ? newId() : meta.id; return; } // hidden in the backup: never a conflict
    const all = await lib.allDocuments();
    const existing = all.find((x) => x.id === meta.id || x.originId === meta.id || (meta.originId && (x.id === meta.originId || x.originId === meta.originId)));
    const onDisk = await store.getJSON(`documents/${meta.id}/meta.json`);
    if (existing) {
      if ((await choose(existing, { id: meta.id, title: meta.title })) === 'replace') d.replace = existing.id;
      d.target = newId();
    } else {
      d.target = onDisk ? newId() : meta.id;
    }
  };

  const onFile = (path: string): EntrySink => {
    if (path === 'manifest.json') return collect(async (b) => { manifest = json(b); });
    if (path === 'profile/folders.json') return collect(async (b) => { folders = json(b); });
    if (path === 'profile/presets.json') return collect(async (b) => { presets = json(b); });
    const m = /^documents\/([^/]+)\/(.+)$/.exec(path);
    if (!m) return collect(async () => {});
    const [, srcId, rest] = m;
    const d = doc(srcId);
    const record = async (bytes: Uint8Array) => { d.written.set(path, { sha256: await sha256Hex(bytes), bytes: bytes.length }); };
    if (rest === 'meta.json') return collect(async (b) => { await record(b); const meta = json<DocumentMeta>(b); d.meta = meta; d.ready = decide(d, meta); await d.ready; });
    if (rest === 'audit.json') return collect(async (b) => { await record(b); d.audit = json(b); });
    if (rest === 'blobs.json') return collect(async (b) => { await record(b); d.blobs = json(b); });
    if (rest.startsWith('files/')) {
      const rel = rest.slice('files/'.length);
      return collect(async (b) => { await record(b); await d.ready; await store.putBytes(`documents/${d.target}/${rel}`, b); });
    }
    if (rest.startsWith('blobs/')) {
      const rel = rest.slice('blobs/'.length);
      let writer: Awaited<ReturnType<BlobStore['writer']>> | null = null;
      const open = async () => {
        await d.ready;
        return (writer ??= await blobs.writer(`documents/${d.target}/${rel}`, d.blobs?.find((x) => x.rel === rel)?.mime ?? 'application/octet-stream'));
      };
      return {
        write: async (c) => { await (await open()).write(c); },
        end: async () => { const man = await (await open()).close(); d.written.set(path, { sha256: man.sha256, bytes: man.size }); },
      };
    }
    return collect(async () => {});
  };

  const cleanupAll = async () => { for (const d of docs.values()) if (d.target) await lib.removeDocumentFiles(d.target).catch(() => {}); };
  try {
    await reader.entries(onFile);
  } catch (e) {
    await cleanupAll();
    throw e;
  }
  if (!manifest) { await cleanupAll(); throw new Error('backup has no manifest'); }

  if (folders.length) await lib.mergeFolders(folders);
  if (presets.length) {
    const have = await lib.listPresets();
    const ids = new Set(have.map((p) => p.id));
    await lib.savePresets([...have, ...presets.filter((p) => !ids.has(p.id))].slice(0, MAX_PRESETS));
  }
  const folderIds = new Set((await lib.listFolders()).map((f) => f.id));
  const imported: DocumentMeta[] = [];
  const skipped: string[] = [];
  const listed = new Set((manifest as BackupManifest).documents.map((e) => e.id));
  for (const [srcId, d] of docs) if (!listed.has(srcId) && d.target) await lib.removeDocumentFiles(d.target); // not in the manifest
  const targetOf = (srcId?: Id) => (srcId ? docs.get(srcId)?.target ?? srcId : undefined);
  for (const entry of (manifest as BackupManifest).documents) {
    const d = docs.get(entry.id);
    if (!d?.meta || !d.target) { skipped.push(entry.title); if (d?.target) await lib.removeDocumentFiles(d.target); continue; }
    const ok = !!d.audit && entry.files.every((f) => {
      const got = d.written.get(f.path);
      return got && got.sha256 === f.sha256 && got.bytes === f.bytes;
    });
    if (!ok) { await lib.removeDocumentFiles(d.target); skipped.push(entry.title); continue; }
    const t = Date.now();
    const audit = await appendAudit(d.audit!, { time: t, author: by, action: 'doc.import', objectIds: [d.target] });
    const meta: DocumentMeta = {
      ...d.meta, id: d.target, profileId: lib.profileId, folderId: d.meta.folderId && folderIds.has(d.meta.folderId) ? d.meta.folderId : null,
      originId: d.target !== d.meta.id ? d.meta.id : d.meta.originId, replacedBy: targetOf(d.meta.replacedBy), updatedAt: t,
    };
    await store.putJSON(`documents/${d.target}/audit.json`, audit);
    if (meta.replacedBy) await lib.publishImportedHidden(meta);
    else await lib.publishImported(meta);
    if (d.replace) await lib.hideReplaced(d.replace, d.target);
    imported.push(meta);
  }
  return { imported, skipped };
}
