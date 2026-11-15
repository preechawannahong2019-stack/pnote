import { appendAudit, type AuditEntry } from '@pnote/core/audit';
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

export class Library {
  constructor(private store: EncryptedStore, private author: Author, private now: () => number = () => Date.now()) {}

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

  listFolders(): Promise<Folder[]> { return this.folders(); }

  async createFolder(name: string, parentId: Id | null): Promise<Folder> {
    const f: Folder = { id: newId(), profileId: this.store.profileId, parentId, name };
    await this.store.putJSON(FOLDERS, [...(await this.folders()), f]);
    return f;
  }

  async renameFolder(id: Id, name: string): Promise<void> {
    await this.store.putJSON(FOLDERS, (await this.folders()).map((f) => (f.id === id ? { ...f, name } : f)));
  }

  async deleteFolder(id: Id): Promise<void> {
    const folders = await this.folders();
    const hasChildren = folders.some((f) => f.parentId === id) || (await this.index()).some((d) => d.folderId === id);
    if (hasChildren) throw new FolderNotEmptyError();
    await this.store.putJSON(FOLDERS, folders.filter((f) => f.id !== id));
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
    await this.putMeta(meta);
    const audit = await appendAudit([], { time: t, author: this.author, action: 'doc.create', objectIds: [meta.id] });
    await this.store.putJSON(`${docDir(meta.id)}/audit.json`, audit);
    return meta;
  }

  async openDocument(id: Id): Promise<{ meta: DocumentMeta; state: DocState; audit: AuditEntry[] }> {
    const meta = await this.getMeta(id);
    const state: DocState = { pages: meta.pages, strokes: {}, shapes: {} };
    for (const p of meta.pages) { state.strokes[p.id] = []; state.shapes[p.id] = []; }
    // load every page file, including pages removed from the document (data is never dropped)
    for (const path of await this.store.list(`${docDir(id)}/pages/`)) {
      const pageId = path.slice(path.lastIndexOf('/') + 1, -'.bin'.length);
      const bin = await this.store.getBytes(path);
      if (!bin) continue;
      const { strokes, shapes } = decodePage(bin);
      state.strokes[pageId] = strokes;
      state.shapes[pageId] = shapes;
    }
    const audit = (await this.store.getJSON<AuditEntry[]>(`${docDir(id)}/audit.json`)) ?? [];
    return { meta, state, audit };
  }

  async saveDocument(meta: DocumentMeta, state: DocState, audit: AuditEntry[], dirtyPageIds: Id[]): Promise<void> {
    for (const pid of dirtyPageIds) {
      await this.store.putBytes(pagePath(meta.id, pid), encodePage(state.strokes[pid] ?? [], state.shapes[pid] ?? []));
    }
    await this.store.putJSON(`${docDir(meta.id)}/audit.json`, audit);
    await this.putMeta({ ...meta, pages: state.pages, updatedAt: this.now() });
  }

  async renameDocument(id: Id, title: string): Promise<void> {
    await this.putMeta({ ...(await this.getMeta(id)), title, updatedAt: this.now() });
  }

  async moveDocument(id: Id, folderId: Id | null): Promise<void> {
    await this.putMeta({ ...(await this.getMeta(id)), folderId, updatedAt: this.now() });
  }

  async listPresets(): Promise<PenPreset[]> { return (await this.store.getJSON<PenPreset[]>(PRESETS)) ?? []; }

  async savePresets(p: PenPreset[]): Promise<void> {
    if (p.length > MAX_PRESETS) throw new TooManyPresetsError();
    await this.store.putJSON(PRESETS, p);
  }
}
