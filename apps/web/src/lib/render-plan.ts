/** Tracks which canvas layers need repainting on the next frame. */
export function createRenderPlan() {
  let base = true;
  let live = true;
  return {
    markBase(): void { base = true; live = true; },
    markLive(): void { live = true; },
    take(): { base: boolean; live: boolean } {
      const out = { base, live };
      base = live = false;
      return out;
    },
  };
}
