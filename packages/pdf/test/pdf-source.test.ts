import { PdfDocumentSource } from '../src/pdf-source';
import { plainPdf, rotatedPdf } from './fixtures/make-fixtures';

function reader(b: Uint8Array) {
  let bytes = 0;
  return { read: async (s: number, e: number) => { bytes += e - s; return b.slice(s, e); }, get bytes() { return bytes; } };
}

describe('PdfDocumentSource', () => {
  it('opens lazily and reads page text without fetching the whole file', async () => {
    const pdf = await plainPdf(3, { padBytes: 3_000_000 });
    const r = reader(pdf);
    const doc = await PdfDocumentSource.open(r.read, pdf.length);
    expect(doc.pageCount).toBe(3);
    const words = await doc.pageWords(2);
    expect(words.map((w) => w.text).join(' ')).toContain('EVIDENCE 2569');
    expect(r.bytes).toBeLessThan(pdf.length);
    await doc.destroy();
  });

  it('returns word boxes in page space', async () => {
    const pdf = await plainPdf(2);
    const doc = await PdfDocumentSource.open(reader(pdf).read, pdf.length);
    const [w] = (await doc.pageWords(2)).filter((x) => x.text.includes('EVIDENCE'));
    const [x0, y0, x1, y1] = w.bbox;
    expect(x0).toBeCloseTo(72, 0);
    expect(y0).toBeGreaterThan(60); // 760 pt from bottom → ~82 pt from top minus font height
    expect(y1).toBeLessThan(100);
    expect(x1).toBeGreaterThan(x0);
    await doc.destroy();
  });

  it('maps rotated page text into the displayed page', async () => {
    const pdf = await rotatedPdf();
    const doc = await PdfDocumentSource.open(reader(pdf).read, pdf.length);
    const [w] = await doc.pageWords(1);
    expect(w.text).toContain('ROTATED');
    const [x0, y0, x1, y1] = w.bbox;
    for (const v of [x0, x1]) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(841.89); }
    for (const v of [y0, y1]) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(595.28); }
    expect(y1 - y0).toBeGreaterThan(x1 - x0); // horizontal text runs vertically after a 90° turn
    await doc.destroy();
  });
});

describe('review fixes: render size and caches', () => {
  it('clamps render size to 4096 px wide and 16 MP', async () => {
    const { clampRenderWidth, MAX_RENDER_WIDTH, MAX_RENDER_PIXELS } = await import('../src/pdf-source');
    const w = clampRenderWidth(595.28, 841.89, 20_000);
    expect(w).toBeLessThanOrEqual(MAX_RENDER_WIDTH);
    expect(w * w * (841.89 / 595.28)).toBeLessThanOrEqual(MAX_RENDER_PIXELS);
    expect(clampRenderWidth(595.28, 841.89, 800)).toBe(800);
    const tall = clampRenderWidth(100, 2000, 4000); // a very tall page is limited by area, not width
    expect(tall * tall * 20).toBeLessThanOrEqual(MAX_RENDER_PIXELS);
  });

  it('keeps thumbnails and OCR renders out of the view cache', async () => {
    const { PdfDocumentSource } = await import('../src/pdf-source');
    const draws: string[] = [];
    const fake = Object.create(PdfDocumentSource.prototype) as PdfDocumentSource;
    Object.assign(fake, { cache: new Map(), side: new Map(), doc: { numPages: 50, getPage: async () => ({ view: [0, 0, 595.28, 841.89] }) } });
    vi.spyOn(fake as never, 'draw').mockImplementation((async (n: number, w: number) => {
      draws.push(`${n}:${w}`);
      return { width: w, height: w } as never;
    }) as never);
    await fake.render(1, 1000, 'view');
    for (let n = 2; n <= 12; n++) await fake.render(n, 120, 'thumb');
    draws.length = 0;
    await fake.render(1, 1000, 'view');
    expect(draws).toEqual([]); // still cached: thumbnails did not evict it
  });
});
