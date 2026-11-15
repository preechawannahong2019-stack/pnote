export const AUTOSAVE_MS = 500;

/** Debounced save that also flushes when the page is hidden or closed. */
export function createAutosave(save: () => Promise<void>, delayMs = AUTOSAVE_MS) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending = false;
  let running: Promise<void> = Promise.resolve();

  const flush = (): Promise<void> => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!pending) return running.catch(() => {});
    pending = false;
    running = running.catch(() => {}).then(save);
    return running;
  };
  const quiet = () => { flush().catch(() => { /* reported by save() */ }); };
  const onHide = quiet;
  const onVisibility = () => { if (document.visibilityState === 'hidden') quiet(); };
  window.addEventListener('pagehide', onHide);
  document.addEventListener('visibilitychange', onVisibility);

  return {
    schedule(): void {
      pending = true;
      if (timer) clearTimeout(timer);
      timer = setTimeout(quiet, delayMs);
    },
    flush,
    dispose(): void {
      if (timer) clearTimeout(timer);
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
