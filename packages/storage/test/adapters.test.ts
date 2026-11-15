import 'fake-indexeddb/auto';
import { MemoryAdapter, type StorageAdapter } from '../src/adapter';
import { IndexedDbAdapter } from '../src/idb-adapter';
import { FilesystemAdapter } from '../src/fs-adapter';
import { memoryFs } from './helpers/mini-fs';

const enc = (s: string) => new TextEncoder().encode(s);
let n = 0;

describe.each<[string, () => StorageAdapter]>([
  ['MemoryAdapter', () => new MemoryAdapter()],
  ['IndexedDbAdapter', () => new IndexedDbAdapter(`test-${n++}`)],
  ['FilesystemAdapter', () => new FilesystemAdapter(memoryFs())],
])('%s', (_name, make) => {
  it('puts, gets and deletes', async () => {
    const a = make();
    await a.put('/a/x', enc('hello'));
    expect(await a.get('/a/x')).toEqual(enc('hello'));
    await a.delete('/a/x');
    expect(await a.get('/a/x')).toBeNull();
  });
  it('returns null for a missing path', async () => {
    expect(await make().get('/nope')).toBeNull();
  });
  it('lists only paths under a prefix, sorted', async () => {
    const a = make();
    await a.put('/a/2', enc('2'));
    await a.put('/b/1', enc('b'));
    await a.put('/a/1', enc('1'));
    await a.put('/ab/1', enc('ab'));
    expect(await a.list('/a/')).toEqual(['/a/1', '/a/2']);
  });
  it('stores a copy, not the caller buffer', async () => {
    const a = make();
    const b = enc('abc');
    await a.put('/x', b);
    b[0] = 0;
    expect(await a.get('/x')).toEqual(enc('abc'));
  });
});
