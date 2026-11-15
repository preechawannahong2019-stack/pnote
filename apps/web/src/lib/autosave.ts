export const AUTOSAVE_MS = 500;

/** Debounced save that also flushes when the page is hidden or closed. */
export function createAutosave(save: () => Promise<void>, delayMs = AUTOSAVE_MS) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending = false;
  let running: Promise<void> = Promise.resolve();

  const flush = (): Promise<void> => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!pending) return running;
    pending = false;
    running = running.then(save, save);
    return running;
  };
  const onHide = () => { void flush(); };
  const onVisibility = () => { if (document.visibilityState === 'hidden') void flush(); };
  window.addEventListener('pagehide', onHide);
  document.addEventListener('visibilitychange', onVisibility);

  return {
    schedule(): void {
      pending = true;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { void flush(); }, delayMs);
    },
    flush,
    dispose(): void {
      if (timer) clearTimeout(timer);
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
