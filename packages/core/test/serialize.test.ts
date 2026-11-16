import { decodePage, encodePage } from '../src/serialize';
import { rectShape, stroke } from './fixtures';

function bigStroke(id: string, n: number) {
  const pts: number[] = [];
  for (let i = 0; i < n; i++) pts.push(i * 0.1, Math.sin(i) * 3.3333, (i % 100) / 100, i * 8);
  return stroke(id, 'pg1', pts);
}

describe('page serialization', () => {
  it('round-trips strokes and shapes exactly, including hidden', () => {
    const s1 = { ...stroke('s1'), hidden: true };
    const s2 = bigStroke('s2', 10);
    const sh = rectShape('sh1', 's1');
    const out = decodePage(encodePage([s1, s2], [sh]));
    expect(out.strokes).toEqual([s1, s2]);
    expect(out.shapes).toEqual([sh]);
    expect(out.strokes[1].points).toBeInstanceOf(Float32Array);
  });

  it('round-trips an empty page', () => {
    expect(decodePage(encodePage([], []))).toEqual({ strokes: [], shapes: [], textBoxes: [] });
  });

  it('handles a 5,000-point stroke', () => {
    const s = bigStroke('long', 5000);
    const back = decodePage(encodePage([s], [])).strokes[0];
    expect(back.points.length).toBe(20000);
    expect(Buffer.from(back.points.buffer).equals(Buffer.from(s.points.buffer))).toBe(true);
  });

  it('decodes a page of 2,000 strokes in under 50 ms', () => {
    const strokes = Array.from({ length: 2000 }, (_, i) => bigStroke(`s${i}`, 50));
    const bin = encodePage(strokes, []);
    const t0 = performance.now();
    const back = decodePage(bin);
    expect(performance.now() - t0).toBeLessThan(50);
    expect(back.strokes).toHaveLength(2000);
    expect(back.strokes[1999].points).toEqual(strokes[1999].points);
  });
});
