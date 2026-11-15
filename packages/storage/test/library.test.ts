import { verifyAudit, appendAudit } from '@pnote/core/audit';
import { applyCommand } from '@pnote/core/doc-state';
import type { PenPreset, Stroke } from '@pnote/core/types';
import { MemoryAdapter } from '../src/adapter';
import { generateDataKey } from '../src/crypto';
import { EncryptedStore } from '../src/encrypted-store';
import { FolderNotEmptyError, Library, TooManyPresetsError } from '../src/library';

const author = { profileId: 'p1', name: 'สมชาย' };
const style = { color: '#000', width: 2, opacity: 1, pressureCurve: 'normal' as const, taperStart: 0, taperEnd: 0, smoothing: 0.5 };

async function setup() {
  const adapter = new MemoryAdapter();
  const store = new EncryptedStore(adapter, await generateDataKey(), 'p1');
  return { adapter, store, lib: new Library(store, author, () => 42) };
}

function stroke(id: string, pageId: string): Stroke {
  return { id, pageId, tool: 'pen', style, points: new Float32Array([1, 2, 0.5, 0]), input: 'pen', author, createdAt: 1 };
}

describe('Library', () => {
  it('creates folders and notebooks and lists them', async () => {
    const { lib } = await setup();
    const f = await lib.createFolder('คดี 2569', null);
    const doc = await lib.createNotebook('สำนวนคดี 2569', f.id, 'lined', 3);
    expect(await lib.listFolders()).toEqual([f]);
    const docs = await lib.listDocuments(f.id);
    expect(docs.map((d) => d.id)).toEqual([doc.id]);
    expect(doc.pages).toHaveLength(3);
    expect(doc.pages[0]).toMatchObject({ source: { type: 'blank', template: 'lined' }, widthPt: 595.28, heightPt: 841.89 });
    expect(await lib.listDocuments(null)).toEqual([]);
  });

  it('defaults to one plain A4 page', async () => {
    const { lib } = await setup();
    const doc = await lib.createNotebook('x', null);
    expect(doc.pages).toHaveLength(1);
    expect(doc.pages[0].source).toEqual({ type: 'blank', template: 'plain' });
  });

  it('searches titles case-insensitively with Thai text', async () => {
    const { lib } = await setup();
    await lib.createNotebook('สำนวนคดี 2569', null);
    await lib.createNotebook('Meeting Notes', null);
    expect((await lib.searchByTitle('คดี')).map((d) => d.title)).toEqual(['สำนวนคดี 2569']);
    expect((await lib.searchByTitle('meeting')).map((d) => d.title)).toEqual(['Meeting Notes']);
  });

  it('saves and re-opens state and audit; doc.create is audited', async () => {
    const { lib } = await setup();
    const meta = await lib.createNotebook('x', null, 'plain', 2);
    const opened = await lib.openDocument(meta.id);
    expect(opened.audit.map((a) => a.action)).toEqual(['doc.create']);
    const p1 = meta.pages[0].id;
    const state = applyCommand(opened.state, { type: 'addStroke', stroke: stroke('s1', p1) });
    const audit = await appendAudit(opened.audit, { time: 43, author, action: 'stroke.add', objectIds: ['s1'] });
    await lib.saveDocument(meta, state, audit, [p1]);
    const again = await lib.openDocument(meta.id);
    expect(again.state).toEqual(state);
    expect(again.audit).toEqual(audit);
    expect(await verifyAudit(again.audit)).toEqual({ ok: true });
  });

  it('writes only dirty pages', async () => {
    const { lib, adapter } = await setup();
    const meta = await lib.createNotebook('x', null, 'plain', 2);
    const { state, audit } = await lib.openDocument(meta.id);
    const spy = vi.spyOn(adapter, 'put');
    await lib.saveDocument(meta, state, audit, [meta.pages[1].id]);
    const pageWrites = spy.mock.calls.map((c) => c[0]).filter((p) => p.includes('/pages/'));
    expect(pageWrites).toEqual([`/p1/documents/${meta.id}/pages/${meta.pages[1].id}.bin`]);
  });

  it('renames and moves documents', async () => {
    const { lib } = await setup();
    const f = await lib.createFolder('F', null);
    const d = await lib.createNotebook('old', null);
    await lib.renameDocument(d.id, 'new');
    await lib.moveDocument(d.id, f.id);
    expect((await lib.listDocuments(f.id)).map((x) => x.title)).toEqual(['new']);
    expect((await lib.openDocument(d.id)).meta.title).toBe('new');
  });

  it('refuses to delete a non-empty folder, deletes an empty one', async () => {
    const { lib } = await setup();
    const f = await lib.createFolder('F', null);
    const child = await lib.createFolder('child', f.id);
    await expect(lib.deleteFolder(f.id)).rejects.toBeInstanceOf(FolderNotEmptyError);
    await lib.deleteFolder(child.id);
    await lib.createNotebook('d', f.id);
    await expect(lib.deleteFolder(f.id)).rejects.toBeInstanceOf(FolderNotEmptyError);
    await lib.renameFolder(f.id, 'G');
    expect((await lib.listFolders()).map((x) => x.name)).toEqual(['G']);
  });

  it('stores up to 10 presets', async () => {
    const { lib } = await setup();
    const mk = (i: number): PenPreset => ({ id: `p${i}`, name: `P${i}`, tool: 'pen', style });
    const ten = Array.from({ length: 10 }, (_, i) => mk(i));
    await lib.savePresets(ten);
    expect(await lib.listPresets()).toEqual(ten);
    await expect(lib.savePresets([...ten, mk(10)])).rejects.toBeInstanceOf(TooManyPresetsError);
  });
});
