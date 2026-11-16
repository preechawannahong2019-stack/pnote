export const DEFAULT_IDLE_MS = 300_000;
const CHECK_MS = 15_000;

/**
 * Locks after `timeoutMs` without activity, measured on the wall clock so a device that
 * slept (timers suspended) locks as soon as it wakes.
 */
export function createIdleLock(timeoutMs: number, onLock: () => void, now: () => number = () => Date.now()) {
  let last = now();
  let locked = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const fire = () => { if (!locked) { locked = true; onLock(); } };
  const check = () => { if (now() - last >= timeoutMs) fire(); };
  const reset = () => {
    if (locked) return;
    last = now();
    if (timer) clearTimeout(timer);
    timer = setTimeout(fire, timeoutMs);
  };
  const onVisibility = () => { if (document.visibilityState === 'visible') check(); };
  const events = ['pointerdown', 'keydown', 'wheel'] as const;
  events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('focus', check);
  const interval = setInterval(check, CHECK_MS);
  reset();
  return {
    reset,
    check,
    dispose(): void {
      if (timer) clearTimeout(timer);
      clearInterval(interval);
      events.forEach((e) => window.removeEventListener(e, reset));
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', check);
    },
  };
}
