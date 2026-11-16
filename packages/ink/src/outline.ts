import { getStroke } from 'perfect-freehand';
import type { InputKind, PenStyle } from '@pnote/core/types';
import { applyPressureCurve } from './pressure';

export const MIN_WIDTH = 0.2;
export const MAX_WIDTH = 20;

export const DEFAULT_PEN: PenStyle = {
  color: '#1a1a1a', width: 1.5, opacity: 1, pressureCurve: 'normal', taperStart: 0.2, taperEnd: 0.3, smoothing: 0.5,
};
export const DEFAULT_HIGHLIGHTER: PenStyle = {
  color: '#ffd400', width: 12, opacity: 0.35, pressureCurve: 'off', taperStart: 0, taperEnd: 0, smoothing: 0.6,
};

const c01 = (v: number) => Math.min(1, Math.max(0, v));

export function clampStyle(s: PenStyle): PenStyle {
  return {
    ...s,
    width: Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, s.width)),
    opacity: c01(s.opacity),
    taperStart: c01(s.taperStart),
    taperEnd: c01(s.taperEnd),
    smoothing: c01(s.smoothing),
  };
}

/** Outline polygon (page points) for a stroke's x,y,p,t samples. */
export function strokeOutline(points: Float32Array, style: PenStyle, input: InputKind): [number, number][] {
  const samples: [number, number, number][] = [];
  for (let i = 0; i + 2 < points.length; i += 4) {
    samples.push([points[i], points[i + 1], applyPressureCurve(points[i + 2], style.pressureCurve)]);
  }
  const off = style.pressureCurve === 'off';
  return getStroke(samples, {
    size: style.width,
    thinning: off ? 0 : 0.6,
    smoothing: style.smoothing,
    streamline: 0.5,
    simulatePressure: !off && input !== 'pen',
    start: { taper: style.taperStart * style.width * 8, cap: true },
    end: { taper: style.taperEnd * style.width * 8, cap: true },
    last: true,
  }) as [number, number][];
}
