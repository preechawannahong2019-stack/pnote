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
    expect(f.doc.render).toHaveBeenCalledWith(5, 800);
  });

  it('prefetches the visible page ±2 only', async () => {
    const f = fakes();
    const pages = Array.from({ length: 20 }, (_, i) => pdfPage(i + 1));
    const ps = new PageSources(meta(pages), f.blobs, f.open as never);
    await ps.prefetchAround(10, 800);
    expect(f.doc.prefetch).toHaveBeenCalledWith([9, 10, 11, 12, 13], 800);
  });
});
