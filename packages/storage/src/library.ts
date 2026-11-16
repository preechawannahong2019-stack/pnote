import { appendAudit, verifyAudit, type AuditEntry } from '@pnote/core/audit';
import type { DocState } from '@pnote/core/doc-state';
import { newId } from '@pnote/core/ids';
import { decodePage, encodePage } from '@pnote/core/serialize';
import { A4, type Author, type DocumentMeta, type Folder, type Id, type OcrPage, type PageRef, type PageTemplate, type PenPreset, type CaptureRecord } from '@pnote/core/types';
import type { EncryptedStore } from './encrypted-store';

export class FolderNotEmptyError extends Error {
  constructor() { super('folder is not empty'); this.name = 'FolderNotEmptyError'; }
}
export class TooManyPresetsError extends Error {
  constructor() { super(`at most ${MAX_PRESETS} presets`); this.name = 'TooManyPresetsError'; }
}
export const MAX_PRESETS = 10;

const FOLDERS = 'folders.json';
const INDEX = 'index.json';
const PRESETS = 'presets.json';
const docDir = (id: Id) => `documents/${id}`;
const pagePath = (docId: Id, pageId: Id) => `${docDir(docId)}/pages/${pageId}.bin`;

const norm = (s: string) => s.normalize('NFC').toLocaleLowerCase('th');

export function blankPage(template: PageTemplate = 'plain'): PageRef {
  return { id: newId(), source: { type: 'blank', template }, widthPt: A4.widthPt, heightPt: A4.heightPt };
}

const localQueues = new Map<string, Promise<unknown>>();
/** Imports running in this tab (other tabs are seen through Web Locks). */
const importsInFlight = new Set<string>();

type Locks = LockManager | undefined;
const webLocks = (): Locks => (globalThis.navigator as (Navigator & { locks?: LockManager }) | undefined)?.locks;

export class Library {
  constructor(private store: EncryptedStore, private author: Author, private now: () => number = () => Date.now()) {}

  /** Serialize read-modify-write of shared library files across tabs (Web Locks) and within this tab. */
  private locked<T>(fn: () => Promise<T>): Promise<T> {
    const name = `pnote-lib-${this.store.profileId}`;
    const locks = (globalThis.navigator as (Navigator & { locks?: LockManager }) | undefined)?.locks;
    const run = locks ? () => locks.request(name, fn) as Promise<T> : fn;
    const prev = localQueues.get(name) ?? Promise.resolve();
    const next = prev.then(run, run);
    localQueues.set(name, next.catch(() => undefined));
    return next;
  }

  private async folders(): Promise<Folder[]> { return (await this.store.getJSON<Folder[]>(FOLDERS)) ?? []; }
  private async index(): Promise<DocumentMeta[]> { return (await this.store.getJSON<DocumentMeta[]>(INDEX)) ?? []; }

  private async putMeta(meta: DocumentMeta): Promise<void> {
    await this.store.putJSON(`${docDir(meta.id)}/meta.json`, meta);
    const idx = (await this.index()).filter((d) => d.id !== meta.id);
    await this.store.putJSON(INDEX, [...idx, meta]);
  }

  private async getMeta(id: Id): Promise<DocumentMeta> {
    const meta = await this.store.getJSON<DocumentMeta>(`${docDir(id)}/meta.json`);
    if (!meta) throw new Error(`no document ${id}`);
    return meta;
  }

  get profileId(): Id { return this.store.profileId; }

  /** Write the audit then the meta (last) of an imported document. */
  async commitImport(meta: DocumentMeta, audit: AuditEntry[]): Promise<void> {
    await this.store.putJSON(`${docDir(meta.id)}/audit.json`, audit);
    await this.locked(() => this.putMeta(meta));
  }

  async removeDocumentFiles(id: Id): Promise<void> {
    for (const p of await this.store.list(`${docDir(id)}/`)) await this.store.delete(p);
  }

  /** Hold the import lock of a document for the whole import so no tab mistakes it for an orphan. */
  async withImportLock<T>(id: Id, fn: () => Promise<T>): Promise<T> {
    const key = `${this.store.profileId}:${id}`;
    importsInFlight.add(key);
    try {
      const locks = webLocks();
      return locks ? ((await locks.request(`pnote-import-${key}`, fn)) as T) : await fn();
    } finally {
      importsInFlight.delete(key);
    }
  }

  private async importRunning(id: Id): Promise<boolean> {
    const key = `${this.store.profileId}:${id}`;
    if (importsInFlight.has(key)) return true;
    const locks = webLocks();
    if (!locks) return false;
    return (await locks.request(`pnote-import-${key}`, { ifAvailable: true }, async (lock) => lock === null)) as boolean;
  }

  /** Remove document folders without meta.json (imports interrupted before completion), skipping imports still running. */
  async cleanupOrphans(): Promise<number> {
    const ids = new Set<string>();
    for (const p of await this.store.list('documents/')) ids.add(p.split('/')[1]);
    let removed = 0;
    for (const id of ids) {
      if (await this.store.getJSON(`${docDir(id)}/meta.json`)) continue;
      if (await this.importRunning(id)) continue;
      await this.removeDocumentFiles(id);
      removed++;
    }
    return removed;
  }

  getCaptureRecord(docId: Id): Promise<CaptureRecord | null> {
    return this.store.getJSON<CaptureRecord>(`${docDir(docId)}/capture.json`);
  }

  putCaptureRecord(docId: Id, rec: CaptureRecord): Promise<void> {
    return this.store.putJSON(`${docDir(docId)}/capture.json`, rec);
  }

  getTextLayer(docId: Id, pageId: Id): Promise<OcrPage | null> {
    return this.store.getJSON<OcrPage>(`${docDir(docId)}/text/${pageId}.json`);
  }

  putTextLayer(docId: Id, layer: OcrPage): Promise<void> {
    return this.store.putJSON(`${docDir(docId)}/text/${layer.pageId}.json`, layer);
  }

  /** Page ids of a document that already have a text layer. */
  async textLayerIds(docId: Id): Promise<Set<Id>> {
    const prefix = `${docDir(docId)}/text/`;
    return new Set((await this.store.list(prefix)).map((p) => p.slice(prefix.length, -'.json'.length)));
  }

  listFolders(): Promise<Folder[]> { return this.folders(); }

  createFolder(name: string, parentId: Id | null): Promise<Folder> {
    return this.locked(async () => {
      const f: Folder = { id: newId(), profileId: this.store.profileId, parentId, name };
      await this.store.putJSON(FOLDERS, [...(await this.folders()), f]);
      return f;
    });
  }

  renameFolder(id: Id, name: string): Promise<void> {
    return this.locked(async () => {
      await this.store.putJSON(FOLDERS, (await this.folders()).map((f) => (f.id === id ? { ...f, name } : f)));
    });
  }

  deleteFolder(id: Id): Promise<void> {
    return this.locked(async () => {
      const folders = await this.folders();
      const hasChildren = folders.some((f) => f.parentId === id) || (await this.index()).some((d) => d.folderId === id);
      if (hasChildren) throw new FolderNotEmptyError();
      await this.store.putJSON(FOLDERS, folders.filter((f) => f.id !== id));
    });
  }

  /** Every document in the library index (all folders). */
  async allDocuments(): Promise<DocumentMeta[]> { return this.index(); }

  /** Every document with a meta.json, including ones hidden because an imported copy replaced them. */
  async allDocumentsIncludingReplaced(): Promise<DocumentMeta[]> {
    const out: DocumentMeta[] = [];
    for (const p of await this.store.list('documents/')) {
      if (!/^documents\/[^/]+\/meta\.json$/.test(p)) continue;
      const m = await this.store.getJSON<DocumentMeta>(p);
      if (m) out.push(m);
    }
    return out.sort((a, b) => a.createdAt - b.createdAt);
  }

  /** Documents hidden by a replacing import: kept on disk, listed here so they can still be opened. */
  async listReplaced(): Promise<DocumentMeta[]> {
    return (await this.allDocumentsIncludingReplaced()).filter((d) => d.replacedBy);
  }

  /** Write the meta of an imported document that was already hidden (replaced) in the backup: not added to the index. */
  async publishImportedHidden(meta: DocumentMeta): Promise<void> {
    await this.store.putJSON(`${docDir(meta.id)}/meta.json`, meta);
  }

  /** Raw access to the profile's encrypted files, for .pnote backup and restore only. */
  backupAccess(): EncryptedStore { return this.store; }

  /** Write an imported document's meta last (makes it visible), under the library lock. */
  async publishImported(meta: DocumentMeta): Promise<void> { await this.locked(() => this.putMeta(meta)); }

  /** Hide a document replaced by an imported copy: removed from the index, files and meta kept. */
  async hideReplaced(id: Id, by: Id): Promise<void> {
    await this.locked(async () => {
      const meta = await this.getMeta(id);
      const audit = (await this.store.getJSON<AuditEntry[]>(`${docDir(id)}/audit.json`)) ?? [];
      await this.store.putJSON(`${docDir(id)}/audit.json`,
        await appendAudit(audit, { time: Date.now(), author: this.author, action: 'doc.replace', objectIds: [id, by] }));
      await this.store.putJSON(`${docDir(id)}/meta.json`, { ...meta, replacedBy: by });
      await this.store.putJSON(INDEX, (await this.index()).filter((d) => d.id !== id));
    });
  }

  /** Add folders that do not exist yet (by id). */
  async mergeFolders(incoming: Folder[]): Promise<void> {
    await this.locked(async () => {
      const have = await this.folders();
      const ids = new Set(have.map((f) => f.id));
      await this.store.putJSON(FOLDERS, [...have, ...incoming.filter((f) => !ids.has(f.id)).map((f) => ({ ...f, profileId: this.store.profileId }))]);
    });
  }

  async listDocuments(folderId: Id | null): Promise<DocumentMeta[]> {
    return (await this.index()).filter((d) => d.folderId === folderId).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async searchByTitle(q: string): Promise<DocumentMeta[]> {
    const needle = norm(q.trim());
    return (await this.index()).filter((d) => norm(d.title).includes(needle));
  }

  async createNotebook(title: string, folderId: Id | null, template: PageTemplate = 'plain', pageCount = 1): Promise<DocumentMeta> {
    const t = this.now();
    const meta: DocumentMeta = {
      id: newId(),
      profileId: this.store.profileId,
      folderId,
      title,
      kind: 'notebook',
      pages: Array.from({ length: Math.max(1, pageCount) }, () => blankPage(template)),
      createdAt: t,
      updatedAt: t,
    };
    const audit = await appendAudit([], { time: t, author: this.author, action: 'doc.create', objectIds: [meta.id] });
    await this.store.putJSON(`${docDir(meta.id)}/audit.json`, audit);
    await this.locked(() => this.putMeta(meta));
    return meta;
  }

  async openDocument(id: Id): Promise<{ meta: DocumentMeta; state: DocState; audit: AuditEntry[]; auditOk: boolean }> {
    const meta = await this.getMeta(id);
    const state: DocState = { pages: meta.pages, strokes: {}, shapes: {}, textBoxes: {} };
    for (const p of meta.pages) { state.strokes[p.id] = []; state.shapes[p.id] = []; state.textBoxes[p.id] = []; }
    // load every page file, including pages removed from the document (data is never dropped)
    for (const path of await this.store.list(`${docDir(id)}/pages/`)) {
      const pageId = path.slice(path.lastIndexOf('/') + 1, -'.bin'.length);
      const bin = await this.store.getBytes(path);
      if (!bin) continue;
      const { strokes, shapes, textBoxes } = decodePage(bin);
      state.strokes[pageId] = strokes;
      state.shapes[pageId] = shapes;
      state.textBoxes[pageId] = textBoxes;
    }
    const audit = (await this.store.getJSON<AuditEntry[]>(`${docDir(id)}/audit.json`)) ?? [];
    const auditOk = (await verifyAudit(audit)).ok;
    return { meta, state, audit, auditOk };
  }

  async saveDocument(meta: DocumentMeta, state: DocState, audit: AuditEntry[], dirtyPageIds: Id[]): Promise<void> {
    for (const pid of dirtyPageIds) {
      await this.store.putBytes(pagePath(meta.id, pid), encodePage(state.strokes[pid] ?? [], state.shapes[pid] ?? [], state.textBoxes?.[pid] ?? []));
    }
    await this.store.putJSON(`${docDir(meta.id)}/audit.json`, audit);
    // re-read so a rename/move made elsewhere is not reverted; this save only owns pages
    await this.locked(async () => {
      const current = (await this.store.getJSON<DocumentMeta>(`${docDir(meta.id)}/meta.json`)) ?? meta;
      await this.putMeta({ ...current, pages: state.pages, updatedAt: this.now() });
    });
  }

  renameDocument(id: Id, title: string): Promise<void> {
    return this.locked(async () => this.putMeta({ ...(await this.getMeta(id)), title, updatedAt: this.now() }));
  }

  moveDocument(id: Id, folderId: Id | null): Promise<void> {
    return this.locked(async () => this.putMeta({ ...(await this.getMeta(id)), folderId, updatedAt: this.now() }));
  }

  async listPresets(): Promise<PenPreset[]> { return (await this.store.getJSON<PenPreset[]>(PRESETS)) ?? []; }

  async savePresets(p: PenPreset[]): Promise<void> {
    if (p.length > MAX_PRESETS) throw new TooManyPresetsError();
    await this.locked(() => this.store.putJSON(PRESETS, p));
  }
}
