import { sha256Hex } from '@pnote/core/hash';
import { MemoryAdapter } from '../src/adapter';
import { BLOB_CHUNK, BlobStore, fileSource, type BlobSource } from '../src/blob-store';
import { generateDataKey } from '../src/crypto';
import { EncryptedStore } from '../src/encrypted-store';

function bytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = (i * 7 + (i >> 9)) & 0xff;
  return b;
}
const memSource = (b: Uint8Array): BlobSource => ({ size: b.length, slice: async (s, e) => b.slice(s, e) });
const same = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b));

async function setup() {
  const adapter = new MemoryAdapter();
  const store = new EncryptedStore(adapter, await generateDataKey(), 'p1');
  return { adapter, store, blobs: new BlobStore(store) };
}

describe('BlobStore', () => {
  const data = bytes(Math.floor(BLOB_CHUNK * 2.5));

  it('writes chunks then a manifest with the SHA-256 of the whole file', async () => {
    const { blobs, store } = await setup();
    const progress: number[] = [];
    const m = await blobs.put('documents/d/source', memSource(data), 'application/pdf', (done) => progress.push(done));
    expect(m).toEqual({ size: data.length, chunks: 3, sha256: await sha256Hex(data), mime: 'application/pdf' });
    expect(await store.list('documents/d/source/')).toEqual(['documents/d/source/000000', 'documents/d/source/000001', 'documents/d/source/000002', 'documents/d/source/manifest.json']);
    expect(progress[progress.length - 1]).toBe(data.length);
    expect(await blobs.manifest('documents/d/source')).toEqual(m);
  });

  it('reads a range by decrypting only the covering chunks', async () => {
    const { blobs, store } = await setup();
    await blobs.put('b', memSource(data), 'application/pdf');
    const spy = vi.spyOn(store, 'getBytes');
    const r = await blobs.readRange('b', 1_048_000, 1_049_000);
    expect(same(r, data.slice(1_048_000, 1_049_000))).toBe(true);
    const chunkReads = spy.mock.calls.map((c) => c[0]).filter((p) => !p.endsWith('manifest.json'));
    expect(chunkReads.sort()).toEqual(['b/000000', 'b/000001']);
  });

  it('caches decrypted chunks', async () => {
    const { blobs, store } = await setup();
    await blobs.put('b', memSource(data), 'application/pdf');
    await blobs.readRange('b', 0, 10);
    const spy = vi.spyOn(store, 'getBytes');
    await blobs.readRange('b', 10, 20);
    expect(spy.mock.calls.filter((c) => c[0] === 'b/000000')).toHaveLength(0);
  });

  it('reads everything back', async () => {
    const { blobs } = await setup();
    await blobs.put('b', memSource(data), 'application/pdf');
    expect(same(await blobs.readAll('b'), data)).toBe(true);
  });

  it('verify detects a swapped chunk', async () => {
    const { blobs, adapter } = await setup();
    await blobs.put('b', memSource(data), 'application/pdf');
    expect(await blobs.verify('b')).toBe(true);
    await adapter.put('/p1/b/000001', (await adapter.get('/p1/b/000000'))!);
    expect(await blobs.verify('b')).toBe(false);
  });

  it('fileSource reads only chunk-sized slices, never the whole blob', async () => {
    const blob = new Blob([data as Uint8Array<ArrayBuffer>]);
    const sliceSpy = vi.spyOn(blob, 'slice');
    const wholeSpy = vi.spyOn(blob, 'arrayBuffer');
    const { blobs } = await setup();
    await blobs.put('b', fileSource(blob), 'application/pdf');
    expect(wholeSpy).not.toHaveBeenCalled();
    for (const [a, b] of sliceSpy.mock.calls) expect((b as number) - (a as number)).toBeLessThanOrEqual(BLOB_CHUNK);
  });

  it('an interrupted put has no manifest', async () => {
    const { blobs, store } = await setup();
    const failing: BlobSource = { size: data.length, slice: async (s, e) => { if (s >= BLOB_CHUNK) throw new Error('crash'); return data.slice(s, e); } };
    await expect(blobs.put('b', failing, 'application/pdf')).rejects.toThrow('crash');
    expect(await blobs.manifest('b')).toBeNull();
    expect((await store.list('b/')).length).toBe(1);
  });

  it('deletes all chunk files', async () => {
    const { blobs, store } = await setup();
    await blobs.put('b', memSource(data), 'application/pdf');
    await blobs.delete('b');
    expect(await store.list('b/')).toEqual([]);
  });
});
