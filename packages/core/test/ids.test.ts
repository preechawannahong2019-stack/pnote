import { newId } from '../src/ids';
import { A4 } from '../src/types';

describe('newId', () => {
  it('returns a uuid string', () => {
    expect(newId()).toMatch(/^[0-9a-f-]{36}$/);
  });
  it('returns distinct values', () => {
    const s = new Set(Array.from({ length: 1000 }, () => newId()));
    expect(s.size).toBe(1000);
  });
});

describe('A4', () => {
  it('is 595.28 x 841.89 pt', () => {
    expect(A4).toEqual({ widthPt: 595.28, heightPt: 841.89 });
  });
});
