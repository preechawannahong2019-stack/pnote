import type { PressureCurve } from '@pnote/core/types';

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function applyPressureCurve(p: number, curve: PressureCurve): number {
  const x = clamp01(p);
  switch (curve) {
    case 'soft': return x ** 0.6;
    case 'normal': return x;
    case 'firm': return x ** 1.6;
    case 'off': return 0.5;
  }
}
