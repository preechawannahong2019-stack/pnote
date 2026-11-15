import { nativeExporter } from '../src/platform/exporter';

function deps(opts: { shareFails?: unknown; saveFails?: unknown } = {}) {
  const written: string[] = [];
  const removed: string[] = [];
  const shared: string[][] = [];
  return {
    written, removed, shared,
    d: {
      writeCache: async (name: string, _b: Uint8Array) => { const uri = `file:///cache/export/${name}`; written.push(uri); return uri; },
      remove: async (uri: string) => { removed.push(uri); },
      share: async (o: { files: string[]; title: string }) => { shared.push(o.files); if (opts.shareFails) throw opts.shareFails; },
      saveToFiles: async (_uri: string) => { if (opts.saveFails) throw opts.saveFails; },
    },
  };
}

describe('nativeExporter', () => {
  it('shares a cache file and deletes it afterwards', async () => {
    const f = deps();
    await nativeExporter(f.d).share('สำนวน/คดี:1.pdf', new Uint8Array([1]));
    expect(f.written).toEqual(['file:///cache/export/สำนวน_คดี_1.pdf']);
    expect(f.shared).toEqual([f.written]);
    expect(f.removed).toEqual(f.written);
  });

  it('deletes the cache file when the user cancels the share sheet', async () => {
    const f = deps({ shareFails: new Error('Share canceled') });
    await expect(nativeExporter(f.d).share('a.pdf', new Uint8Array([1]))).resolves.toBeUndefined();
    expect(f.removed).toEqual(f.written);
  });

  it('deletes the cache file and reports other share errors', async () => {
    const f = deps({ shareFails: new Error('boom') });
    await expect(nativeExporter(f.d).share('a.pdf', new Uint8Array([1]))).rejects.toThrow('boom');
    expect(f.removed).toEqual(f.written);
  });

  it('save also cleans up, on success and on error', async () => {
    const ok = deps();
    await nativeExporter(ok.d).save('a.pdf', new Uint8Array([1]));
    expect(ok.removed).toEqual(ok.written);
    const bad = deps({ saveFails: new Error('disk') });
    await expect(nativeExporter(bad.d).save('a.pdf', new Uint8Array([1]))).rejects.toThrow('disk');
    expect(bad.removed).toEqual(bad.written);
  });
});
