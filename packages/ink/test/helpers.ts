import type { Shape, Stroke } from '@pnote/core/types';
import { DEFAULT_PEN } from '../src/outline';

export const author = { profileId: 'p1', name: 'A' };
export function mk(id: string, xy: number[], extra: Partial<Stroke> = {}): Stroke {
  const pts: number[] = [];
  for (let i = 0; i < xy.length; i += 2) pts.push(xy[i], xy[i + 1], 0.5, i * 4);
  return { id, pageId: 'pg', tool: 'pen', style: { ...DEFAULT_PEN, width: 2 }, points: new Float32Array(pts), input: 'pen', author, createdAt: 1, ...extra };
}
export function hline(id: string, x0: number, x1: number, y: number, n = 20): Stroke {
  const xy: number[] = [];
  for (let i = 0; i < n; i++) xy.push(x0 + ((x1 - x0) * i) / (n - 1), y);
  return mk(id, xy);
}
export function rect(id: string, x: number, y: number, w: number, h: number): Shape {
  return { id, pageId: 'pg', geometry: { kind: 'rect', x, y, w, h }, style: DEFAULT_PEN, sourceStrokeId: 's', author, createdAt: 1 };
}
export function flat(pts: [number, number][], dt = 8): Float32Array {
  return new Float32Array(pts.flatMap(([x, y], i) => [x, y, 0.5, i * dt]));
}
