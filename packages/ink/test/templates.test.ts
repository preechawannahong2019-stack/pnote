import { templateLines } from '../src/templates';

describe('templateLines', () => {
  it('plain has no lines', () => {
    expect(templateLines('plain', 595.28, 841.89)).toEqual([]);
  });
  it('lined starts at 72 pt with 24 pt spacing inside the page', () => {
    const lines = templateLines('lined', 595.28, 841.89);
    expect(lines[0]).toEqual({ x1: 0, y1: 72, x2: 595.28, y2: 72 });
    expect(lines[1].y1 - lines[0].y1).toBe(24);
    expect(lines.every((l) => l.y1 < 841.89)).toBe(true);
  });
  it('grid has lines every 5 mm both ways', () => {
    const lines = templateLines('grid', 595.28, 841.89);
    const expected = Math.floor(595.28 / 14.17) + Math.floor(841.89 / 14.17);
    expect(Math.abs(lines.length - expected)).toBeLessThanOrEqual(2);
    expect(lines.every((l) => l.x1 <= 595.28 && l.y1 <= 841.89)).toBe(true);
  });
});
