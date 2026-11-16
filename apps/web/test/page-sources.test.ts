import type { DocumentMeta, PageRef } from '@pnote/core/types';
import type { BlobStore } from '@pnote/storage/blob-store';
import { PageSources } from '../src/lib/page-sources';

const pdfPage = (n: number): PageRef => ({ id: `p${n}`, source: { type: 'pdf', pageNo: n }, widthPt: 100, heightPt: 100 });
const meta = (pages: PageRef[], kind: DocumentMeta['kind'] = 'pdf'): DocumentMeta => ({ id: 'd', profileId: 'p', folderId: null, title: 't', kind, pages, createdAt: 1, updatedAt: 1 });

function fakes() {
  const rendered: number[] = [];
  const doc = { pageCount: 20, render: vi.fn(async (n: number) => { rendered.push(n); return document.createElement('canvas'); }), prefetch: vi.fn(), destroy: vi.fn(async () => {}) };
  const blobs = { manifest: vi.fn(async () => ({ size: 10, chunks: 1, sha256: '', mime: 'application/pdf' })), readRange: vi.fn(), readAll: vi.fn() } as unknown as BlobStore;
  const open = vi.fn(async () => doc);
  return { doc, blobs, open, rendered };
}

describe('PageSources', () => {
  it('returns null for blank pages without opening anything', async () => {
    const f = fakes();
    const ps = new PageSources(meta([{ id: 'b', source: { type: 'blank', template: 'plain' }, widthPt: 1, heightPt: 1 }], 'notebook'), f.blobs, f.open as never);
    expect(await ps.background(meta([]).pages[0] ?? { id: 'b', source: { type: 'blank', template: 'plain' }, widthPt: 1, heightPt: 1 }, 500)).toBeNull();
    expect(f.open).not.toHaveBeenCalled();
  });

  it('renders the pdf page asked for', async () => {
    const f = fakes();
    const pages = Array.from({ length: 20 }, (_, i) => pdfPage(i + 1));
    const ps = new PageSources(meta(pages), f.blobs, f.open as never);
    await ps.background(pages[4], 800);
    expect(f.doc.render).toHaveBeenCalledWith(5, 800, 'view');
  });

  it('prefetches the visible page ±2 only', async () => {
    const f = fakes();
    const pages = Array.from({ length: 20 }, (_, i) => pdfPage(i + 1));
    const ps = new PageSources(meta(pages), f.blobs, f.open as never);
    await ps.prefetchAround(10, 800);
    expect(f.doc.prefetch).toHaveBeenCalledWith([9, 10, 11, 12, 13], 800);
  });
});

describe('review fixes: source integrity for the certificate', () => {
  it('requires the stored manifest to match the imported SHA-256 and the chunks to verify', async () => {
    const { sourceIntegrity } = await import('../src/lib/import-export');
    const meta = { kind: 'pdf', sourceSha256: 'aaa' } as never;
    expect(await sourceIntegrity(meta, { sha256: 'aaa' } as never, async () => true)).toBe(true);
    expect(await sourceIntegrity(meta, { sha256: 'bbb' } as never, async () => true)).toBe(false);
    expect(await sourceIntegrity(meta, { sha256: 'aaa' } as never, async () => false)).toBe(false);
    expect(await sourceIntegrity(meta, null, async () => true)).toBe(false);
    expect(await sourceIntegrity({ kind: 'notebook' } as never, null, async () => true)).toBeNull();
  });
});

describe('review fixes: export size guard', () => {
  it('refuses originals too large to export on this device', async () => {
    const { exportSizeLimit, ExportTooLarge, assertExportable } = await import('../src/lib/import-export');
    expect(exportSizeLimit(4)).toBe(150_000_000);
    expect(exportSizeLimit(undefined)).toBe(150_000_000);
    expect(exportSizeLimit(8)).toBe(600_000_000);
    expect(() => assertExportable(300_000_000, 4)).toThrow(ExportTooLarge);
    expect(() => assertExportable(100_000_000, 4)).not.toThrow();
    expect(() => assertExportable(300_000_000, 8)).not.toThrow();
  });
});

describe('review fixes: prefetch resolution and render purpose', () => {
  it('prefetches neighbours at no more than 1536 px', async () => {
    const f = fakes();
    const pages = Array.from({ length: 20 }, (_, i) => pdfPage(i + 1));
    const ps = new PageSources(meta(pages), f.blobs, f.open as never);
    await ps.prefetchAround(10, 6000);
    expect(f.doc.prefetch).toHaveBeenCalledWith([9, 10, 11, 12, 13], 1536);
  });
  it('passes the purpose through to the render cache', async () => {
    const f = fakes();
    const pages = Array.from({ length: 3 }, (_, i) => pdfPage(i + 1));
    const ps = new PageSources(meta(pages), f.blobs, f.open as never);
    await ps.background(pages[0], 120, 'thumb');
    expect(f.doc.render).toHaveBeenCalledWith(1, 120, 'thumb');
  });
});

describe('review fixes: background while zooming', () => {
  it('keeps the previous render of the same page until the sharper one arrives', async () => {
    const { backgroundFor } = await import('../src/lib/page-sources');
    const img = {} as CanvasImageSource;
    expect(backgroundFor({ key: 'p1:768', img }, 'p1:1536')).toBe(img); // zoom changed: stale but same page
    expect(backgroundFor({ key: 'p1:768', img }, 'p1:768')).toBe(img);
    expect(backgroundFor({ key: 'p1:768', img }, 'p2:768')).toBeNull(); // another page: never show the wrong one
    expect(backgroundFor(null, 'p1:768')).toBeNull();
  });
});
