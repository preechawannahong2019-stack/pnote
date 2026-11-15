import { appendAudit, verifyAudit, type AuditEntry } from '@pnote/core/audit';
import type { DocState } from '@pnote/core/doc-state';
import { newId } from '@pnote/core/ids';
import { decodePage, encodePage } from '@pnote/core/serialize';
import { A4, type Author, type DocumentMeta, type Folder, type Id, type PageRef, type PageTemplate, type PenPreset } from '@pnote/core/types';
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

  /** Remove document folders without meta.json (imports interrupted before completion). */
  async cleanupOrphans(): Promise<number> {
    const ids = new Set<string>();
    for (const p of await this.store.list('documents/')) ids.add(p.split('/')[1]);
    let removed = 0;
    for (const id of ids) {
      if (await this.store.getJSON(`${docDir(id)}/meta.json`)) continue;
      await this.removeDocumentFiles(id);
      removed++;
    }
    return removed;
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
