import type { OcrPage, TextBox } from '@pnote/core/types';
import { appendAudit } from '@pnote/core/audit';
import { MemoryAdapter } from '@pnote/storage/adapter';
import { generateDataKey } from '@pnote/storage/crypto';
import { EncryptedStore } from '@pnote/storage/encrypted-store';
import { Library } from '@pnote/storage/library';
import { normalizeForSearch, searchLibrary, searchPage } from '../src/search';

const n = normalizeForSearch;
const layer = (pageId: string, words: string[]): OcrPage => ({
  pageId, engine: 'tesseract', lang: 'tha+eng', doneAt: 1,
  words: words.map((text, i) => ({ text, bbox: [i * 10, 0, i * 10 + 9, 10] as [number, number, number, number], conf: 90 })),
});
const author = { profileId: 'p1', name: 'A' };
const box = (text: string): TextBox => ({ id: 't', pageId: 'p', x: 5, y: 5, w: 50, h: 20, text, font: 'sarabun', sizePt: 12, color: '#000', bold: false, author, createdAt: 1, updatedAt: 1 });

describe('normalizeForSearch', () => {
  it('drops spaces OCR puts between Thai characters', () => expect(n('ผู้ ต้อง หา')).toBe(n('ผู้ต้องหา')));
  it('treats nikhahit + sara aa as sara am', () => expect(n('นํ้า')).toBe(n('น้ำ')));
  it('removes zero-width characters', () => expect(n(`คดี${String.fromCharCode(0x200b)}ที่`)).toBe(n('คดีที่')));
  it('maps Thai digits to Arabic', () => expect(n('๒๕๖๙')).toBe('2569'));
  it('keeps English words spaced and lowercases', () => expect(n('  EVIDENCE   2569 ')).toBe('evidence 2569'));
});

describe('searchPage', () => {
  it('matches a query split across OCR words and returns their rects', () => {
    const r = searchPage(layer('p', ['คดี', 'ผู้', 'ต้อง', 'หา', 'ลัก']), [], 'ผู้ต้องหา');
    expect(r?.rects).toEqual([[10, 0, 19, 10], [20, 0, 29, 10], [30, 0, 39, 10]]);
    expect(r?.snippet).toContain('ผู้ต้องหา');
  });
  it('finds text in text boxes', () => {
    expect(searchPage(null, [box('นัดสอบปากคำ')], 'สอบปากคำ')?.rects).toEqual([[5, 5, 55, 25]]);
  });
  it('ignores hidden text boxes and returns null on no match', () => {
    expect(searchPage(null, [{ ...box('ซ่อน'), hidden: true }], 'ซ่อน')).toBeNull();
    expect(searchPage(layer('p', ['abc']), [], 'zzz')).toBeNull();
  });
});

describe('searchLibrary', () => {
  async function setup() {
    const store = new EncryptedStore(new MemoryAdapter(), await generateDataKey(), 'p1');
    const lib = new Library(store, author);
    const a = await lib.createNotebook('สำนวนคดีลักทรัพย์', null, 'plain', 2);
    const b = await lib.createNotebook('อื่น ๆ', null, 'plain', 1);
    await lib.putTextLayer(a.id, layer(a.pages[1].id, ['ผู้', 'ต้อง', 'หา']));
    await lib.putTextLayer(b.id, layer(b.pages[0].id, ['ผู้ต้องหา', 'คนที่', 'สอง']));
    const opened = await lib.openDocument(b.id);
    const state = { ...opened.state, textBoxes: { [b.pages[0].id]: [{ ...box('ผู้ต้องหาหลบหนี'), pageId: b.pages[0].id }] } };
    await lib.saveDocument(opened.meta, state, await appendAudit(opened.audit, { time: 2, author, action: 'text.add', objectIds: ['t'] }), [b.pages[0].id]);
    return { lib, a, b };
  }

  it('returns title matches and page hits from several documents', async () => {
    const { lib, a, b } = await setup();
    const r = await searchLibrary(lib, 'ผู้ต้องหา');
    expect(r.hits.map((h) => [h.docId, h.pageIndex])).toEqual(expect.arrayContaining([[a.id, 1], [b.id, 0]]));
    expect(r.hits.find((h) => h.docId === b.id)?.rects.length).toBe(2); // OCR word + text box
    expect((await searchLibrary(lib, 'ลักทรัพย์')).titleMatches.map((d) => d.id)).toEqual([a.id]);
  });

  it('respects the limit and an abort signal', async () => {
    const { lib } = await setup();
    expect((await searchLibrary(lib, 'ผู้ต้องหา', { limit: 1 })).hits).toHaveLength(1);
    const ac = new AbortController();
    ac.abort();
    expect((await searchLibrary(lib, 'ผู้ต้องหา', { signal: ac.signal })).hits).toEqual([]);
  });
});
