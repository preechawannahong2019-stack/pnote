import { encodeKey, FilesystemAdapter } from '../src/fs-adapter';
import { memoryFs } from './helpers/mini-fs';

const enc = (s: string) => new TextEncoder().encode(s);

describe('FilesystemAdapter', () => {
  it('keeps the old value when the app dies between writing the temp file and renaming it', async () => {
    const fs = memoryFs();
    const a = new FilesystemAdapter(fs);
    await a.put('/p1/x', enc('old'));
    fs.failNextRename = true;
    await expect(a.put('/p1/x', enc('new'))).rejects.toThrow();
    expect(await new FilesystemAdapter(fs).get('/p1/x')).toEqual(enc('old'));
  });

  it('round-trips Thai keys and spaces and lists the original keys', async () => {
    const a = new FilesystemAdapter(memoryFs());
    await a.put('/p1/documents/สำนวน คดี/meta.json', enc('1'));
    await a.put('/p1/documents/b/x.bin', enc('2'));
    await a.put('/p2/y', enc('3'));
    expect(await a.get('/p1/documents/สำนวน คดี/meta.json')).toEqual(enc('1'));
    expect(await a.list('/p1/')).toEqual(['/p1/documents/b/x.bin', '/p1/documents/สำนวน คดี/meta.json']);
  });

  it('ignores leftover temp files when listing', async () => {
    const fs = memoryFs();
    const a = new FilesystemAdapter(fs);
    await a.put('/p1/x', enc('old'));
    fs.failNextRename = true;
    await a.put('/p1/y', enc('new')).catch(() => {});
    expect(await a.list('/p1/')).toEqual(['/p1/x']);
  });

  it('excludes its root from backups once', async () => {
    const fs = memoryFs();
    const a = new FilesystemAdapter(fs);
    await a.put('/a', enc('1'));
    await a.put('/b', enc('2'));
    expect(fs.excluded).toEqual(['pnote']);
  });

  it('encodes keys safely', () => {
    expect(encodeKey('/p1/documents/a b')).toBe('pnote/p1/documents/a%20b');
    expect(encodeKey('/p1/x?y#z')).toBe('pnote/p1/x%3Fy%23z');
  });
});
