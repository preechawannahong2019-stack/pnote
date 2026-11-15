import { verifyAudit } from '@pnote/core/audit';
import type { Stroke } from '@pnote/core/types';
import { MemoryAdapter } from '@pnote/storage/adapter';
import { generateDataKey } from '@pnote/storage/crypto';
import { EncryptedStore } from '@pnote/storage/encrypted-store';
import { Library } from '@pnote/storage/library';
import { createAutosave } from '../src/lib/autosave';
import { acquireDocLock } from '../src/lib/doc-lock';
import { createIdleLock, DEFAULT_IDLE_MS } from '../src/lib/idle-lock';
import { EditorSession } from '../src/lib/session';
import { loadToolbarState, saveToolbarState, sizeBucket } from '../src/lib/toolbar-state';

const author = { profileId: 'p1', name: 'A' };
const style = { color: '#000', width: 2, opacity: 1, pressureCurve: 'normal' as const, taperStart: 0, taperEnd: 0, smoothing: 0.5 };
const stroke = (id: string, pageId: string): Stroke => ({ id, pageId, tool: 'pen', style, points: new Float32Array([1, 2, 0.5, 0, 5, 6, 0.5, 8]), input: 'pen', author, createdAt: 1 });

afterEach(() => { vi.useRealTimers(); });

describe('createAutosave', () => {
  it('saves once, 500 ms after the last schedule', async () => {
    vi.useFakeTimers();
    const save = vi.fn(async () => {});
    const a = createAutosave(save);
    a.schedule(); await vi.advanceTimersByTimeAsync(50);
    a.schedule(); await vi.advanceTimersByTimeAsync(50);
    a.schedule();
    await vi.advanceTimersByTimeAsync(499);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
    a.dispose();
  });

  it('flushes immediately on pagehide', async () => {
    vi.useFakeTimers();
    const save = vi.fn(async () => {});
    const a = createAutosave(save);
    a.schedule();
    window.dispatchEvent(new Event('pagehide'));
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenCalledTimes(1);
    a.dispose();
  });

  it('flush does nothing when nothing is pending', async () => {
    const save = vi.fn(async () => {});
    const a = createAutosave(save);
    await a.flush();
    expect(save).not.toHaveBeenCalled();
    a.dispose();
  });
});

describe('createIdleLock', () => {
  it('locks after 5 minutes idle and reset postpones it', () => {
    vi.useFakeTimers();
    const onLock = vi.fn();
    const l = createIdleLock(DEFAULT_IDLE_MS, onLock);
    vi.advanceTimersByTime(DEFAULT_IDLE_MS - 1000);
    window.dispatchEvent(new Event('pointerdown'));
    vi.advanceTimersByTime(DEFAULT_IDLE_MS - 1000);
    expect(onLock).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(onLock).toHaveBeenCalledTimes(1);
    l.dispose();
    expect(DEFAULT_IDLE_MS).toBe(300_000);
  });
});

describe('toolbar state', () => {
  beforeEach(() => localStorage.clear());
  it('buckets screen widths', () => {
    expect([sizeBucket(500), sizeBucket(1000), sizeBucket(1600)]).toEqual(['s', 'm', 'l']);
  });
  it('defaults, round-trips, and keeps buckets independent', () => {
    expect(loadToolbarState(500)).toEqual({ collapsed: false, dock: 'top', fullscreen: false });
    saveToolbarState(500, { collapsed: true, dock: 'left', fullscreen: false });
    expect(loadToolbarState(600)).toEqual({ collapsed: true, dock: 'left', fullscreen: false });
    expect(loadToolbarState(1600)).toEqual({ collapsed: false, dock: 'top', fullscreen: false });
  });
  it('ignores corrupt stored values', () => {
    localStorage.setItem('pnote.toolbar.s', '{bad');
    expect(loadToolbarState(500).dock).toBe('top');
  });
});

describe('acquireDocLock', () => {
  it('is read-only when the lock is held elsewhere', async () => {
    const locks = { request: (_n: string, _o: unknown, cb: (l: null) => unknown) => Promise.resolve(cb(null)) };
    vi.stubGlobal('navigator', { ...navigator, locks });
    expect(await acquireDocLock('d1')).toEqual({ readOnly: true });
    vi.unstubAllGlobals();
  });
  it('is writable when the lock is free and release ends it', async () => {
    let held = false;
    const locks = {
      request: (_n: string, _o: unknown, cb: (l: object) => Promise<void>) => { held = true; return cb({}).then(() => { held = false; }); },
    };
    vi.stubGlobal('navigator', { ...navigator, locks });
    const l = await acquireDocLock('d1');
    expect(l.readOnly).toBe(false);
    expect(held).toBe(true);
    if (!l.readOnly) l.release();
    await Promise.resolve(); await Promise.resolve();
    expect(held).toBe(false);
    vi.unstubAllGlobals();
  });
});

describe('EditorSession', () => {
  async function lib() {
    const store = new EncryptedStore(new MemoryAdapter(), await generateDataKey(), 'p1');
    return new Library(store, author);
  }
  const writable = async () => ({ readOnly: false as const, release: () => {} });
  const readOnly = async () => ({ readOnly: true as const });

  it('autosaves strokes with a verified audit chain', async () => {
    const l = await lib();
    const meta = await l.createNotebook('x', null);
    const s = await EditorSession.open(l, author, meta.id, { lock: writable });
    await s.run({ type: 'addStroke', stroke: stroke('s1', meta.pages[0].id) });
    await s.flushNow();
    const again = await l.openDocument(meta.id);
    expect(again.state.strokes[meta.pages[0].id].map((x) => x.id)).toEqual(['s1']);
    expect(again.audit.map((a) => a.action)).toEqual(['doc.create', 'stroke.add']);
    expect(await verifyAudit(again.audit)).toEqual({ ok: true });
    await s.close();
  });

  it('autosaves after 500 ms without an explicit flush', async () => {
    const l = await lib();
    const meta = await l.createNotebook('x', null);
    const s = await EditorSession.open(l, author, meta.id, { lock: writable });
    vi.useFakeTimers();
    await s.run({ type: 'addStroke', stroke: stroke('s1', meta.pages[0].id) });
    await vi.advanceTimersByTimeAsync(500);
    vi.useRealTimers();
    await s.idle();
    expect((await l.openDocument(meta.id)).state.strokes[meta.pages[0].id]).toHaveLength(1);
    await s.close();
  });

  it('audits undo and redo', async () => {
    const l = await lib();
    const meta = await l.createNotebook('x', null);
    const s = await EditorSession.open(l, author, meta.id, { lock: writable });
    await s.run({ type: 'addStroke', stroke: stroke('s1', meta.pages[0].id) });
    await s.undo();
    await s.redo();
    await s.close();
    expect((await l.openDocument(meta.id)).audit.map((a) => a.action)).toEqual(['doc.create', 'stroke.add', 'stroke.hide', 'stroke.unhide']);
  });

  it('read-only session does not write', async () => {
    const l = await lib();
    const meta = await l.createNotebook('x', null);
    const s = await EditorSession.open(l, author, meta.id, { lock: readOnly });
    expect(s.readOnly).toBe(true);
    await s.run({ type: 'addStroke', stroke: stroke('s1', meta.pages[0].id) });
    await s.close();
    expect((await l.openDocument(meta.id)).state.strokes[meta.pages[0].id]).toEqual([]);
  });
});

describe('review fixes: saving', () => {
  async function lib() {
    const store = new EncryptedStore(new MemoryAdapter(), await generateDataKey(), 'p1');
    return new Library(store, author);
  }
  const writable = async () => ({ readOnly: false as const, release: () => {} });

  it('keeps dirty pages after a failed save, reports the error, and saves on retry', async () => {
    const l = await lib();
    const meta = await l.createNotebook('x', null);
    const s = await EditorSession.open(l, author, meta.id, { lock: writable });
    const errors: unknown[] = [];
    s.onSaveError((e) => errors.push(e));
    const real = l.saveDocument.bind(l);
    const spy = vi.spyOn(l, 'saveDocument').mockRejectedValueOnce(new Error('quota'));
    await s.run({ type: 'addStroke', stroke: stroke('s1', meta.pages[0].id) });
    await s.flushNow().catch(() => {});
    expect(errors).toHaveLength(1);
    expect(s.saveFailed).toBe(true);
    spy.mockImplementation(real);
    await s.flushNow();
    expect(s.saveFailed).toBe(false);
    expect((await l.openDocument(meta.id)).state.strokes[meta.pages[0].id]).toHaveLength(1);
    await s.close();
  });

  it('close resolves even when the final save fails', async () => {
    const l = await lib();
    const meta = await l.createNotebook('x', null);
    const s = await EditorSession.open(l, author, meta.id, { lock: writable });
    vi.spyOn(l, 'saveDocument').mockRejectedValue(new Error('quota'));
    await s.run({ type: 'addStroke', stroke: stroke('s1', meta.pages[0].id) });
    await expect(s.close()).resolves.toBeUndefined();
  });

  it('pagehide right after a stroke saves it even before the audit hash resolves', async () => {
    const l = await lib();
    const meta = await l.createNotebook('x', null);
    const s = await EditorSession.open(l, author, meta.id, { lock: writable });
    const save = vi.spyOn(l, 'saveDocument');
    vi.useFakeTimers();
    const p = s.run({ type: 'addStroke', stroke: stroke('s1', meta.pages[0].id) });
    window.dispatchEvent(new Event('pagehide'));
    await p;
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(1); // saved by pagehide, not by the 500 ms debounce
    vi.useRealTimers();
    await s.idle();
    const again = await l.openDocument(meta.id);
    expect(again.state.strokes[meta.pages[0].id]).toHaveLength(1);
    expect(again.audit.map((a) => a.action)).toContain('stroke.add');
    await s.close();
  });
});

describe('review fixes: idle lock across device sleep', () => {
  it('locks on wake when the wall clock passed the timeout while timers were suspended', () => {
    let now = 1_000_000;
    const onLock = vi.fn();
    const l = createIdleLock(DEFAULT_IDLE_MS, onLock, () => now);
    now += DEFAULT_IDLE_MS + 1; // device slept; no timer fired
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(onLock).toHaveBeenCalledTimes(1);
    l.dispose();
  });
  it('does not lock on wake before the timeout', () => {
    let now = 1_000_000;
    const onLock = vi.fn();
    const l = createIdleLock(DEFAULT_IDLE_MS, onLock, () => now);
    now += 1000;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(onLock).not.toHaveBeenCalled();
    l.dispose();
  });
});

describe('review fixes: session audit check', () => {
  it('flags a broken audit chain and releases the lock when open fails', async () => {
    const store = new EncryptedStore(new MemoryAdapter(), await generateDataKey(), 'p1');
    const l = new Library(store, author);
    const meta = await l.createNotebook('x', null);
    const audit = (await store.getJSON<{ objectIds: string[] }[]>(`documents/${meta.id}/audit.json`))!;
    audit[0].objectIds = ['forged'];
    await store.putJSON(`documents/${meta.id}/audit.json`, audit);
    const s = await EditorSession.open(l, author, meta.id, { lock: async () => ({ readOnly: false, release: () => {} }) });
    expect(s.auditBroken).toBe(true);
    await s.close();
    const release = vi.fn();
    vi.spyOn(l, 'openDocument').mockRejectedValueOnce(new Error('bad'));
    await expect(EditorSession.open(l, author, meta.id, { lock: async () => ({ readOnly: false, release }) })).rejects.toThrow();
    expect(release).toHaveBeenCalled();
  });
});
