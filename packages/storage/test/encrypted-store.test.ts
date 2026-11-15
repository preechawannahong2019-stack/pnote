import { MemoryAdapter } from '../src/adapter';
import { generateDataKey } from '../src/crypto';
import { EncryptedStore } from '../src/encrypted-store';

describe('EncryptedStore', () => {
  it('round-trips JSON and bytes', async () => {
    const s = new EncryptedStore(new MemoryAdapter(), await generateDataKey(), 'p1');
    await s.putJSON('index.json', { title: 'สำนวน' });
    expect(await s.getJSON('index.json')).toEqual({ title: 'สำนวน' });
    await s.putBytes('b.bin', new Uint8Array([1, 2, 3]));
    expect(await s.getBytes('b.bin')).toEqual(new Uint8Array([1, 2, 3]));
    expect(await s.getJSON('missing.json')).toBeNull();
  });

  it('does not store plaintext', async () => {
    const adapter = new MemoryAdapter();
    const s = new EncryptedStore(adapter, await generateDataKey(), 'p1');
    await s.putJSON('meta.json', { title: 'secret-title' });
    const raw = await adapter.get('/p1/meta.json');
    expect(raw).not.toBeNull();
    expect(new TextDecoder('latin1').decode(raw!)).not.toContain('secret-title');
  });

  it('scopes paths per profile', async () => {
    const adapter = new MemoryAdapter();
    const a = new EncryptedStore(adapter, await generateDataKey(), 'pA');
    const b = new EncryptedStore(adapter, await generateDataKey(), 'pB');
    await b.putJSON('docs/x.json', { v: 1 });
    await a.putJSON('docs/y.json', { v: 2 });
    expect(await a.list('docs/')).toEqual(['docs/y.json']);
    expect(await a.getJSON('docs/x.json')).toBeNull();
    expect(await adapter.list('/')).toEqual(['/pA/docs/y.json', '/pB/docs/x.json']);
  });

  it('rejects paths that escape the profile', async () => {
    const s = new EncryptedStore(new MemoryAdapter(), await generateDataKey(), 'pA');
    await expect(s.putJSON('../pB/x.json', {})).rejects.toThrow();
  });

  it('deletes', async () => {
    const s = new EncryptedStore(new MemoryAdapter(), await generateDataKey(), 'p1');
    await s.putJSON('a.json', 1);
    await s.delete('a.json');
    expect(await s.getJSON('a.json')).toBeNull();
  });
});
