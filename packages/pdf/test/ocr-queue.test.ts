import type { PageRef } from '@pnote/core/types';
import { MemoryAdapter } from '@pnote/storage/adapter';
import { generateDataKey } from '@pnote/storage/crypto';
import { EncryptedStore } from '@pnote/storage/encrypted-store';
import { Library } from '@pnote/storage/library';
import { OcrQueue, type OcrEngine, type OcrWord } from '../src/ocr-queue';

const author = { profileId: 'p1', name: 'A' };
const pdfPage = (n: number): PageRef => ({ id: `pg${n}`, source: { type: 'pdf', pageNo: n }, widthPt: 595, heightPt: 842 });
const blank: PageRef = { id: 'blank', source: { type: 'blank', template: 'plain' }, widthPt: 595, heightPt: 842 };
const word = (text: string): OcrWord => ({ text, bbox: [1, 2, 3, 4], conf: 90 });

async function setup(pages: PageRef[], pdfText: Record<number, string> = {}, engineImpl?: (n: number) => OcrWord[]) {
  const adapter = new MemoryAdapter();
  const lib = new Library(new EncryptedStore(adapter, await generateDataKey(), 'p1'), author);
  let calls = 0;
  const engine: OcrEngine = {
    recognize: vi.fn(async () => { calls++; return engineImpl ? engineImpl(calls) : [word('ผู้ต้องหา')]; }),
    terminate: vi.fn(async () => {}),
  };
  const deps = {
    lib, docId: 'd1', pages,
    render: vi.fn(async () => ({}) as CanvasImageSource),
    pdfWords: vi.fn(async (n: number) => (pdfText[n] ? [{ text: pdfText[n], bbox: [0, 0, 1, 1] as [number, number, number, number], conf: 100 }] : [])),
    engine: vi.fn(async () => engine),
    now: () => 5,
  };
  return { adapter, lib, engine, deps };
}

async function run(q: OcrQueue) {
  const done = new Promise<void>((r) => q.onProgress((d, t) => { if (d === t) r(); }));
  q.start();
  await done;
}

describe('OcrQueue', () => {
  it('uses pdf text when the page has enough of it', async () => {
    const { lib, engine, deps } = await setup([pdfPage(1)], { 1: 'This page already has plenty of text' });
    await run(new OcrQueue(deps));
    expect(engine.recognize).not.toHaveBeenCalled();
    expect(await lib.getTextLayer('d1', 'pg1')).toMatchObject({ engine: 'pdf-text', lang: 'tha+eng', doneAt: 5 });
  });

  it('OCRs a scanned page and skips blank pages', async () => {
    const { lib, engine, deps } = await setup([pdfPage(1), blank]);
    const progress: string[] = [];
    const q = new OcrQueue(deps);
    q.onProgress((d, t) => progress.push(`${d}/${t}`));
    await run(q);
    expect(engine.recognize).toHaveBeenCalledTimes(1);
    expect((await lib.getTextLayer('d1', 'pg1'))?.words[0].text).toBe('ผู้ต้องหา');
    expect(await lib.getTextLayer('d1', 'blank')).toBeNull();
    expect(progress).toContain('1/1');
  });

  it('resumes from the next unprocessed page', async () => {
    const { engine, deps } = await setup([pdfPage(1), pdfPage(2)]);
    const q1 = new OcrQueue(deps);
    await new Promise<void>((r) => { q1.onProgress((d) => { if (d === 1) { void q1.stop().then(r); } }); q1.start(); });
    const before = vi.mocked(engine.recognize).mock.calls.length;
    await run(new OcrQueue(deps));
    expect(vi.mocked(engine.recognize).mock.calls.length - before).toBe(1);
  });

  it('keeps going when one page fails and reports the error', async () => {
    const { lib, deps } = await setup([pdfPage(1), pdfPage(2)], {}, (n) => { if (n === 1) throw new Error('boom'); return [word('ok')]; });
    const errors: unknown[] = [];
    const q = new OcrQueue(deps);
    q.onError((e) => errors.push(e));
    await run(q);
    expect(errors).toHaveLength(1);
    expect(await lib.getTextLayer('d1', 'pg1')).toBeNull();
    expect((await lib.getTextLayer('d1', 'pg2'))?.words[0].text).toBe('ok');
  });

  it('stores text layers encrypted', async () => {
    const { adapter, deps } = await setup([pdfPage(1)], {}, () => [word('SECRETWORD')]);
    await run(new OcrQueue(deps));
    for (const p of await adapter.list('/p1/documents/d1/text/')) {
      expect(new TextDecoder('latin1').decode((await adapter.get(p))!)).not.toContain('SECRETWORD');
    }
    expect((await adapter.list('/p1/documents/d1/text/')).length).toBe(1);
  });
});
