import type { Stroke } from '@pnote/core/types';
import { MemoryAdapter } from '@pnote/storage/adapter';
import { generateDataKey } from '@pnote/storage/crypto';
import { EncryptedStore } from '@pnote/storage/encrypted-store';
import { Library } from '@pnote/storage/library';
import { createIdleLock } from '../src/lib/idle-lock';
import { EditorSession } from '../src/lib/session';
import { bindIdleLock, bindSession, nativeLifecycle } from '../src/platform/lifecycle';

function fakeApp() {
  const listeners: Record<string, (() => void)[]> = { pause: [], resume: [] };
  return {
    listeners,
    addListener: async (e: 'pause' | 'resume', cb: () => void) => {
      listeners[e].push(cb);
      return { remove: () => { listeners[e] = listeners[e].filter((x) => x !== cb); } };
    },
    emit: (e: 'pause' | 'resume') => listeners[e].forEach((cb) => cb()),
  };
}
const author = { profileId: 'p1', name: 'A' };
const style = { color: '#000', width: 2, opacity: 1, pressureCurve: 'normal' as const, taperStart: 0, taperEnd: 0, smoothing: 0.5 };

describe('native lifecycle', () => {
  it('saves a pending stroke as soon as the app goes to the background', async () => {
    const lib = new Library(new EncryptedStore(new MemoryAdapter(), await generateDataKey(), 'p1'), author);
    const meta = await lib.createNotebook('x', null);
    const session = await EditorSession.open(lib, author, meta.id, { lock: async () => ({ readOnly: false, release: () => {} }) });
    const save = vi.spyOn(lib, 'saveDocument');
    const app = fakeApp();
    const off = bindSession(nativeLifecycle(app), session);
    await new Promise((r) => setTimeout(r, 0));
    vi.useFakeTimers();
    const stroke: Stroke = { id: 's1', pageId: meta.pages[0].id, tool: 'pen', style, points: new Float32Array([1, 2, 0.5, 0]), input: 'pen', author, createdAt: 1 };
    await session.run({ type: 'addStroke', stroke });
    app.emit('pause');
    await vi.advanceTimersByTimeAsync(0); // not the 500 ms debounce
    expect(save).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
    off();
    await session.close();
  });

  it('locks on resume after 6 minutes of wall-clock time, not after 1 minute', async () => {
    let now = 1_000_000;
    const onLock = vi.fn();
    const lock = createIdleLock(300_000, onLock, () => now);
    const app = fakeApp();
    const off = bindIdleLock(nativeLifecycle(app), lock);
    await new Promise((r) => setTimeout(r, 0));
    now += 60_000;
    app.emit('resume');
    expect(onLock).not.toHaveBeenCalled();
    now += 300_000;
    app.emit('resume');
    expect(onLock).toHaveBeenCalledTimes(1);
    off();
    lock.dispose();
  });

  it('removes its listeners', async () => {
    const app = fakeApp();
    const lc = nativeLifecycle(app);
    const off = lc.onBackground(() => {});
    await new Promise((r) => setTimeout(r, 0));
    expect(app.listeners.pause).toHaveLength(1);
    off();
    await new Promise((r) => setTimeout(r, 0));
    expect(app.listeners.pause).toHaveLength(0);
  });
});
