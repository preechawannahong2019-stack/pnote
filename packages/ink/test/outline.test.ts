import type { PenStyle } from '@pnote/core/types';
import { applyPressureCurve } from '../src/pressure';
import { clampStyle, DEFAULT_HIGHLIGHTER, DEFAULT_PEN, strokeOutline } from '../src/outline';

describe('applyPressureCurve', () => {
  it.each([
    ['soft', 0.4353],
    ['normal', 0.25],
    ['firm', 0.1088],
    ['off', 0.5],
  ] as const)('%s at 0.25', (curve, v) => {
    expect(applyPressureCurve(0.25, curve)).toBeCloseTo(v, 3);
  });
  it('clamps to [0,1]', () => {
    expect(applyPressureCurve(1.5, 'normal')).toBe(1);
    expect(applyPressureCurve(-1, 'soft')).toBe(0);
  });
});

describe('clampStyle', () => {
  it('clamps width into 0.2–20 and fractions into 0–1', () => {
    expect(clampStyle({ ...DEFAULT_PEN, width: 30 }).width).toBe(20);
    expect(clampStyle({ ...DEFAULT_PEN, width: 0.05 }).width).toBe(0.2);
    expect(clampStyle({ ...DEFAULT_PEN, opacity: 2, taperStart: -1, smoothing: 9 })).toMatchObject({ opacity: 1, taperStart: 0, smoothing: 1 });
  });
  it('defaults are valid', () => {
    expect(clampStyle(DEFAULT_PEN)).toEqual(DEFAULT_PEN);
    expect(DEFAULT_HIGHLIGHTER.opacity).toBeLessThanOrEqual(0.4);
  });
});

function line(n: number, p = 0.5): Float32Array {
  const a: number[] = [];
  for (let i = 0; i < n; i++) a.push(i * 2, 100, p, i * 8);
  return new Float32Array(a);
}

function bbox(poly: [number, number][]) {
  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

describe('strokeOutline', () => {
  const style: PenStyle = { ...DEFAULT_PEN, width: 4, pressureCurve: 'off', taperStart: 0, taperEnd: 0 };
  it('makes a polygon about as tall as the pen width', () => {
    const poly = strokeOutline(line(30), style, 'pen');
    expect(poly.length).toBeGreaterThan(4);
    expect(bbox(poly).h).toBeGreaterThan(4 * 0.8);
    expect(bbox(poly).h).toBeLessThan(4 * 1.2);
  });
  it('has constant width with pressure off', () => {
    const varying = new Float32Array(line(40));
    for (let i = 2; i < varying.length; i += 4) varying[i] = (i % 16) / 16;
    const poly = strokeOutline(varying, style, 'pen');
    const mid = poly.filter(([x]) => x > 20 && x < 60);
    const top = mid.filter(([, y]) => y < 100).map(([, y]) => 100 - y);
    expect(Math.max(...top) / Math.min(...top)).toBeLessThan(1.1);
  });
  it('returns a dot for a single point', () => {
    expect(strokeOutline(new Float32Array([5, 5, 0.5, 0]), style, 'pen').length).toBeGreaterThan(0);
  });
});
