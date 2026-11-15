import { isHolding, recognizeShape } from '../src/shapes';
import { flat } from './helpers';

let seed = 1;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
const jitter = (pts: [number, number][], a = 1) => pts.map(([x, y]) => [x + rnd() * a, y + rnd() * a] as [number, number]);
function seg(ax: number, ay: number, bx: number, by: number, n = 20): [number, number][] {
  return Array.from({ length: n }, (_, i) => [ax + ((bx - ax) * i) / n, ay + ((by - ay) * i) / n]);
}
function poly(vs: [number, number][], closed = true): [number, number][] {
  const out: [number, number][] = [];
  const list = closed ? [...vs, vs[0]] : vs;
  for (let i = 1; i < list.length; i++) out.push(...seg(list[i - 1][0], list[i - 1][1], list[i][0], list[i][1]));
  out.push(list[list.length - 1]);
  return out;
}

describe('recognizeShape', () => {
  it('fits a noisy line', () => {
    const g = recognizeShape(flat(jitter(seg(10, 10, 200, 60, 60).concat([[200, 60]]))));
    expect(g?.kind).toBe('line');
    if (g?.kind === 'line') {
      expect(Math.hypot(g.x1 - 10, g.y1 - 10)).toBeLessThan(3);
      expect(Math.hypot(g.x2 - 200, g.y2 - 60)).toBeLessThan(3);
    }
  });

  it('recognizes an arrow', () => {
    const pts = poly([[0, 100], [200, 100], [180, 85], [200, 100], [180, 115]], false);
    expect(recognizeShape(flat(pts))?.kind).toBe('arrow');
  });

  it('fits a noisy circle', () => {
    const pts: [number, number][] = Array.from({ length: 80 }, (_, i) => {
      const a = (i / 79) * Math.PI * 2;
      return [100 + 50 * Math.cos(a), 100 + 50 * Math.sin(a)];
    });
    const g = recognizeShape(flat(jitter(pts, 1.5)));
    expect(g?.kind).toBe('ellipse');
    if (g?.kind === 'ellipse') {
      expect(Math.abs(g.rx - 50)).toBeLessThan(5);
      expect(Math.abs(g.ry - 50)).toBeLessThan(5);
      expect(Math.hypot(g.cx - 100, g.cy - 100)).toBeLessThan(5);
    }
  });

  it('recognizes a rough square', () => {
    const g = recognizeShape(flat(jitter(poly([[0, 0], [100, 2], [102, 100], [-1, 98]]))));
    expect(g?.kind).toBe('rect');
    if (g?.kind === 'rect') {
      expect(Math.abs(g.w - 100)).toBeLessThan(6);
      expect(Math.abs(g.h - 100)).toBeLessThan(6);
    }
  });

  it('recognizes a triangle', () => {
    expect(recognizeShape(flat(jitter(poly([[0, 100], [50, 0], [100, 100]]))))?.kind).toBe('triangle');
  });

  it('returns null for a random scribble', () => {
    seed = 7;
    const pts: [number, number][] = Array.from({ length: 60 }, () => [100 + rnd() * 60, 100 + rnd() * 60]);
    expect(recognizeShape(flat(pts))).toBeNull();
  });

  it('returns null for a letter S', () => {
    const pts: [number, number][] = [];
    for (let i = 0; i <= 40; i++) {
      const a = Math.PI * 0.2 + (i / 40) * Math.PI * 1.3;
      pts.push([50 + 25 * Math.cos(a), 25 - 25 * Math.sin(a)]);
    }
    for (let i = 0; i <= 40; i++) {
      const a = Math.PI * 0.5 - (i / 40) * Math.PI * 1.3;
      pts.push([50 + 25 * Math.cos(a), 75 - 25 * Math.sin(a)]);
    }
    expect(recognizeShape(flat(pts))).toBeNull();
  });
});

describe('isHolding', () => {
  function stroke(holdMs: number, drift = 0): Float32Array {
    const pts: number[] = [];
    for (let i = 0; i < 20; i++) pts.push(i * 5, 0, 0.5, i * 8);
    const t0 = 19 * 8;
    for (let t = 8; t <= holdMs; t += 8) pts.push(95 + (drift * t) / holdMs, 0, 0.5, t0 + t);
    return new Float32Array(pts);
  }
  it('is true after 520 ms still', () => {
    const p = stroke(520);
    expect(isHolding(p, p[p.length - 1])).toBe(true);
  });
  it('is false after 480 ms', () => {
    const p = stroke(480);
    expect(isHolding(p, p[p.length - 1])).toBe(false);
  });
  it('counts time since the last sample when the pen stays still', () => {
    const p = stroke(200);
    expect(isHolding(p, p[p.length - 1] + 320)).toBe(true);
  });
  it('is false with 5 pt drift', () => {
    const p = stroke(600, 5);
    expect(isHolding(p, p[p.length - 1])).toBe(false);
  });
});
