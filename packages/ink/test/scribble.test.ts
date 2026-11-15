import { isScribble, scribbleTargets } from '../src/scribble';
import { flat, hline, rect } from './helpers';

/** zig-zag across x0..x1 around y, `legs` legs, densely sampled */
function zigzag(x0: number, x1: number, y: number, legs: number, amp = 6): Float32Array {
  const pts: [number, number][] = [];
  for (let l = 0; l < legs; l++) {
    const from = l % 2 === 0 ? x0 : x1;
    const to = l % 2 === 0 ? x1 : x0;
    for (let i = 0; i <= 10; i++) pts.push([from + ((to - from) * i) / 10, y + (l % 2 ? amp : -amp) * (i / 10)]);
  }
  return flat(pts);
}

describe('isScribble', () => {
  it('detects a zig-zag with 4 reversals', () => {
    expect(isScribble(zigzag(0, 40, 50, 5))).toBe(true);
  });
  it('rejects a "w" with 2 reversals', () => {
    expect(isScribble(zigzag(0, 40, 50, 3))).toBe(false);
  });
  it('rejects a straight line', () => {
    expect(isScribble(flat(Array.from({ length: 30 }, (_, i) => [i * 3, 10] as [number, number])))).toBe(false);
  });
  it('rejects tiny jitter legs shorter than 4 pt', () => {
    expect(isScribble(zigzag(0, 2, 50, 6, 0.5))).toBe(false);
  });
  it('detects a vertical zig-zag', () => {
    const z = zigzag(0, 40, 50, 5);
    const rotated = new Float32Array(z);
    for (let i = 0; i < z.length; i += 4) { rotated[i] = z[i + 1]; rotated[i + 1] = z[i]; }
    expect(isScribble(rotated)).toBe(true);
  });
});

describe('scribbleTargets', () => {
  it('returns strokes the scribble crosses', () => {
    const a = hline('a', 0, 40, 50);
    const b = hline('b', 0, 40, 200);
    expect(scribbleTargets(zigzag(0, 40, 50, 5), [a, b], [])).toEqual(['a']);
  });
  it('returns nothing over an empty area', () => {
    expect(scribbleTargets(zigzag(0, 40, 50, 5), [hline('b', 0, 40, 200)], [])).toEqual([]);
  });
  it('returns a shape it crosses', () => {
    expect(scribbleTargets(zigzag(-10, 30, 10, 5, 20), [], [rect('r', 0, 0, 20, 20)])).toEqual(['r']);
  });
  it('ignores hidden strokes', () => {
    expect(scribbleTargets(zigzag(0, 40, 50, 5), [{ ...hline('a', 0, 40, 50), hidden: true }], [])).toEqual([]);
  });
});
