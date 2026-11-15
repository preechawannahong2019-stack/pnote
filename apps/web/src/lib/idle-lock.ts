export const DEFAULT_IDLE_MS = 300_000;

export function createIdleLock(timeoutMs: number, onLock: () => void) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const reset = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(onLock, timeoutMs);
  };
  const events = ['pointerdown', 'keydown', 'wheel'] as const;
  events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
  reset();
  return {
    reset,
    dispose(): void {
      if (timer) clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, reset));
    },
  };
}
