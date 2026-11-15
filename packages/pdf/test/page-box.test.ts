import type { PdfPageBox } from '@pnote/core/types';
import { pageToPdf, pageToPdfMatrix, pdfToPage } from '../src/page-box';

const base = { x: 50, y: 60, w: 350, h: 440 };
const corners: Record<PdfPageBox['rotate'], [number, number]> = { 0: [50, 500], 90: [50, 60], 180: [400, 60], 270: [400, 500] };

describe.each([0, 90, 180, 270] as const)('rotate %i', (rotate) => {
  const box: PdfPageBox = { ...base, rotate };
  it('maps the displayed top-left to the right crop-box corner', () => {
    const [x, y] = pageToPdf(box, 0, 0);
    expect(x).toBeCloseTo(corners[rotate][0]);
    expect(y).toBeCloseTo(corners[rotate][1]);
  });
  it('keeps points inside the crop box', () => {
    const turned = rotate === 90 || rotate === 270;
    const [x, y] = pageToPdf(box, turned ? 440 : 350, turned ? 350 : 440);
    expect(x).toBeGreaterThanOrEqual(50 - 1e-9); expect(x).toBeLessThanOrEqual(400 + 1e-9);
    expect(y).toBeGreaterThanOrEqual(60 - 1e-9); expect(y).toBeLessThanOrEqual(500 + 1e-9);
  });
  it('round-trips random points', () => {
    for (let i = 0; i < 20; i++) {
      const px = Math.random() * 300, py = Math.random() * 300;
      const [x, y] = pdfToPage(box, ...pageToPdf(box, px, py));
      expect(x).toBeCloseTo(px); expect(y).toBeCloseTo(py);
    }
  });
  it('matrix agrees with pageToPdf', () => {
    const [a, b, c, d, e, f] = pageToPdfMatrix(box);
    const [px, py] = [12, 34];
    const [x, y] = pageToPdf(box, px, py);
    expect(a * px + c * py + e).toBeCloseTo(x);
    expect(b * px + d * py + f).toBeCloseTo(y);
  });
});
