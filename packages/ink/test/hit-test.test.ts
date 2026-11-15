import { objectsInLasso, shapesNearPoint, strokeBBox, strokesNearPoint } from '../src/hit-test';
import { hline, mk, rect } from './helpers';

describe('strokesNearPoint', () => {
  it('finds a stroke under the point', () => {
    expect(strokesNearPoint(50, 100, 3, [hline('a', 0, 100, 100)])).toEqual(['a']);
  });
  it('misses a stroke 10 pt away with radius 5', () => {
    expect(strokesNearPoint(50, 110, 5, [hline('a', 0, 100, 100)])).toEqual([]);
  });
  it('finds a point between two samples of a sparse stroke', () => {
    expect(strokesNearPoint(50, 100, 1, [mk('a', [0, 100, 100, 100])])).toEqual(['a']);
  });
  it('skips hidden strokes', () => {
    expect(strokesNearPoint(50, 100, 3, [{ ...hline('a', 0, 100, 100), hidden: true }])).toEqual([]);
  });
  it('is fast on 2,000 strokes of 200 points', () => {
    const strokes = Array.from({ length: 2000 }, (_, i) => hline(`s${i}`, 0, 500, i * 0.4, 200));
    const t0 = performance.now();
    strokesNearPoint(250, 400, 5, strokes);
    expect(performance.now() - t0).toBeLessThan(50);
  });
});

describe('strokeBBox', () => {
  it('covers all points', () => {
    expect(strokeBBox(mk('a', [1, 2, 5, -3, 3, 9]))).toEqual({ minX: 1, minY: -3, maxX: 5, maxY: 9 });
  });
});

describe('objectsInLasso', () => {
  const lasso: [number, number][] = [[0, 0], [100, 0], [100, 100], [0, 100]];
  it('selects strokes fully inside', () => {
    const a = hline('a', 10, 90, 20);
    const b = hline('b', 10, 90, 50);
    const c = hline('c', 200, 300, 50);
    expect(objectsInLasso(lasso, [a, b, c], [])).toEqual(['a', 'b']);
  });
  it('selects a stroke 60% inside, not one 40% inside', () => {
    const sixty = hline('six', 40, 140, 30, 101);
    const forty = hline('four', 60, 160, 60, 101);
    expect(objectsInLasso(lasso, [sixty, forty], [])).toEqual(['six']);
  });
  it('selects shapes by bbox center', () => {
    expect(objectsInLasso(lasso, [], [rect('in', 10, 10, 20, 20), rect('out', 90, 90, 40, 40)])).toEqual(['in']);
  });
});

describe('shapesNearPoint', () => {
  it('hits a rectangle edge, not its empty middle', () => {
    const r = rect('r', 0, 0, 100, 100);
    expect(shapesNearPoint(0, 50, 3, [r])).toEqual(['r']);
    expect(shapesNearPoint(50, 50, 3, [r])).toEqual([]);
  });
});

describe('text boxes in hit testing', () => {
  const tb = (id: string, x: number, y: number, extra = {}) => ({ id, pageId: 'pg', x, y, w: 50, h: 20, text: 'ก', font: 'sarabun' as const, sizePt: 12, color: '#000', bold: false, author: { profileId: 'p', name: 'A' }, createdAt: 1, updatedAt: 1, ...extra });
  it('textBoxesAt hits inside the box only, skipping hidden', async () => {
    const { textBoxesAt } = await import('../src/hit-test');
    expect(textBoxesAt(20, 15, [tb('a', 10, 10), tb('b', 10, 10, { hidden: true })])).toEqual(['a']);
    expect(textBoxesAt(70, 15, [tb('a', 10, 10)])).toEqual([]);
  });
  it('lasso selects a text box by its centre', () => {
    expect(objectsInLasso([[0, 0], [100, 0], [100, 100], [0, 100]], [], [], [tb('a', 10, 10), tb('b', 200, 10)])).toEqual(['a']);
  });
});
