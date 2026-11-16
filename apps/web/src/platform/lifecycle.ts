/** App moving to/from the background. In a native WebView `pagehide` may never fire before the OS kills the app. */
export interface Lifecycle {
  onBackground(cb: () => void): () => void;
  onForeground(cb: () => void): () => void;
}

export function webLifecycle(): Lifecycle {
  const on = (want: 'hidden' | 'visible', cb: () => void) => {
    const h = () => { if (document.visibilityState === want) cb(); };
    document.addEventListener('visibilitychange', h);
    return () => document.removeEventListener('visibilitychange', h);
  };
  return { onBackground: (cb) => on('hidden', cb), onForeground: (cb) => on('visible', cb) };
}

type AppEvents = { addListener(e: 'pause' | 'resume', cb: () => void): Promise<{ remove(): void | Promise<void> }> };

export function nativeLifecycle(app: AppEvents): Lifecycle {
  const on = (e: 'pause' | 'resume', cb: () => void) => {
    const handle = app.addListener(e, cb);
    return () => { void handle.then((h) => h.remove()); };
  };
  return { onBackground: (cb) => on('pause', cb), onForeground: (cb) => on('resume', cb) };
}

let current: Lifecycle | null = null;
export function setLifecycle(l: Lifecycle): void { current = l; }
export function getLifecycle(): Lifecycle { return (current ??= webLifecycle()); }

/** Save immediately when the app goes to the background. */
export function bindSession(l: Lifecycle, session: { flushNow(): Promise<void> }): () => void {
  return l.onBackground(() => { session.flushNow().catch(() => { /* reported by the session */ }); });
}

/** Re-check the wall-clock idle lock when the app returns. */
export function bindIdleLock(l: Lifecycle, lock: { check(): void }): () => void {
  return l.onForeground(() => lock.check());
}
