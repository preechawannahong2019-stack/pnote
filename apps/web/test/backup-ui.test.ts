import { nativeExporter, type NativeExportDeps } from '../src/platform/exporter';
import { IncomingFiles, type IncomingFile } from '../src/platform/incoming';
import { backupFileName, checkBackupPassword, isBackupFile } from '../src/lib/backup-flow';

describe('backup password checks', () => {
  it('rejects short and mismatched passwords', () => {
    expect(checkBackupPassword('123456789', '123456789')).toBe('รหัสผ่านไฟล์สำรองต้องมีอย่างน้อย 10 ตัวอักษร');
    expect(checkBackupPassword('1234567890', '1234567891')).toBe('รหัสผ่านทั้งสองช่องไม่ตรงกัน');
    expect(checkBackupPassword('1234567890', '1234567890')).toBeNull();
  });

  it('names the file after the title and the date', () => {
    expect(backupFileName('คดี/1', new Date(2026, 10, 15))).toBe('คดี_1_2026-11-15.pnote');
    expect(isBackupFile({ name: 'A.PNOTE' })).toBe(true);
    expect(isBackupFile({ name: 'a.pdf' })).toBe(false);
  });
});

function deps(opts: { shareFails?: unknown } = {}) {
  const written: string[] = [];
  const removed: string[] = [];
  const shared: string[][] = [];
  const bytes: number[] = [];
  const d: NativeExportDeps = {
    writeCache: async () => { throw new Error('not used'); },
    createCache: async (name) => { const uri = `file:///cache/export/${name}`; written.push(uri); return { uri, append: async (b) => { bytes.push(...b); } }; },
    remove: async (uri) => { removed.push(uri); },
    share: async (o) => { shared.push(o.files); if (opts.shareFails) throw opts.shareFails; },
    saveToFiles: async () => {},
  };
  return { written, removed, shared, bytes, d };
}

describe('native streaming export', () => {
  it('streams into a cache file, shares it, then deletes it', async () => {
    const f = deps();
    await nativeExporter(f.d).shareStream('a.pnote', 'application/octet-stream', async (s) => {
      await s.write(new Uint8Array([1, 2])); await s.write(new Uint8Array([3])); await s.close();
    });
    expect(f.bytes).toEqual([1, 2, 3]);
    expect(f.shared).toEqual([f.written]);
    expect(f.removed).toEqual(f.written);
  });

  it('deletes the cache file when the share sheet is cancelled', async () => {
    const f = deps({ shareFails: new Error('Share canceled') });
    await nativeExporter(f.d).shareStream('a.pnote', 'application/octet-stream', async (s) => { await s.close(); });
    expect(f.removed).toEqual(f.written);
  });

  it('deletes the cache file and does not share when writing fails', async () => {
    const f = deps();
    await expect(nativeExporter(f.d).shareStream('a.pnote', 'application/octet-stream', async (s) => {
      await s.write(new Uint8Array([1])); await s.abort(); throw new Error('disk');
    })).rejects.toThrow('disk');
    expect(f.shared).toEqual([]);
    expect(f.removed).toEqual(f.written);
  });
});

describe('incoming .pnote files', () => {
  it('wait in the queue until a profile takes them', async () => {
    let cb: ((f: IncomingFile) => void) | null = null;
    const inc = new IncomingFiles({ onFile: (c) => { cb = c; return () => {}; }, read: async () => new Blob(['x']), remove: async () => {} });
    cb!({ name: 'b.pnote', mime: 'application/octet-stream', path: 'in/b.pnote' });
    expect(inc.pending.map((x) => x.name)).toEqual(['b.pnote']);
    expect(isBackupFile(inc.pending[0])).toBe(true);
  });
});

describe('restore a profile from a backup', async () => {
  it('leaves no profile behind when the backup turns out to be damaged', async () => {
    const good = new Uint8Array(await (await makeBackup()).arrayBuffer());
    const cut = new Blob([good.slice(0, good.length - 40)]); // header and password check still pass
    const svc = new ProfileService(new MemoryAdapter(), WebNoDeviceKey);
    await expect(restoreProfile(svc, cut, 'backup-pass-1', 'บ๊อบ', 'password2', '#0f0')).rejects.toBeInstanceOf(BackupCorrupt);
    expect(await svc.list()).toEqual([]);
  });

  const { MemoryAdapter } = await import('@pnote/storage/adapter');
  const { WebNoDeviceKey } = await import('@pnote/storage/device-key');
  const { ProfileService } = await import('@pnote/storage/profiles');
  const { Library } = await import('@pnote/storage/library');
  const { BlobStore } = await import('@pnote/storage/blob-store');
  const { exportProfile } = await import('@pnote/storage/backup-io');
  const { restoreProfile } = await import('../src/lib/backup-flow');
  const { BackupWrongPassword, BackupCorrupt } = await import('@pnote/storage/backup');

  async function makeBackup() {
    const svc = new ProfileService(new MemoryAdapter(), WebNoDeviceKey);
    const { profile } = await svc.create('อลิส', 'password1', '#f00');
    const r = await svc.unlock(profile.id, 'password1');
    if (!r.ok) throw new Error();
    const by = { profileId: profile.id, name: profile.name };
    const lib = new Library(r.store, by);
    await lib.createNotebook('สมุดคดี', null, 'plain');
    const parts: Uint8Array[] = [];
    await exportProfile(lib, new BlobStore(r.store), { write: async (b) => { parts.push(b.slice()); }, close: async () => {}, abort: async () => {} }, 'backup-pass-1', by);
    return new Blob(parts as Uint8Array<ArrayBuffer>[]);
  }

  it('creates the profile only after the backup password is right', async () => {
    const file = await makeBackup();
    const svc = new ProfileService(new MemoryAdapter(), WebNoDeviceKey);
    await expect(restoreProfile(svc, file, 'wrong-password', 'บ๊อบ', 'password2', '#0f0')).rejects.toBeInstanceOf(BackupWrongPassword);
    expect(await svc.list()).toEqual([]);
    const out = await restoreProfile(svc, file, 'backup-pass-1', 'บ๊อบ', 'password2', '#0f0');
    expect(out.recoveryCode).toBeTruthy();
    expect(out.imported.map((d) => d.title)).toEqual(['สมุดคดี']);
    expect(out.skipped).toEqual([]);
    const r = await svc.unlock(out.profile.id, 'password2');
    if (!r.ok) throw new Error();
    expect((await new Library(r.store, { profileId: out.profile.id, name: 'บ๊อบ' }).listDocuments(null)).map((d) => d.title)).toEqual(['สมุดคดี']);
  });
});

describe('web streaming export', async () => {
  const { blobCollector } = await import('../src/platform/exporter');
  it('folds written chunks into a Blob as it goes instead of keeping them all as arrays', async () => {
    const c = blobCollector(4 << 20);
    const chunk = new Uint8Array(1 << 20).fill(7);
    for (let i = 0; i < 10; i++) await c.sink.write(chunk);
    expect(c.heldBytes).toBeLessThanOrEqual(4 << 20);
    const b = c.blob('application/octet-stream');
    expect(b.size).toBe(10 << 20);
    expect(new Uint8Array(await b.slice((10 << 20) - 1).arrayBuffer())).toEqual(new Uint8Array([7]));
  });
});

describe('web save straight to disk', async () => {
  const { webExporter } = await import('../src/platform/exporter');
  afterEach(() => { delete (globalThis as { showSaveFilePicker?: unknown }).showSaveFilePicker; });
  function picker() {
    const got: number[] = [];
    const state = { closed: false, aborted: false, name: '' };
    (globalThis as { showSaveFilePicker?: unknown }).showSaveFilePicker = async (o: { suggestedName: string }) => {
      state.name = o.suggestedName;
      return { createWritable: async () => ({ write: async (b: Uint8Array) => { got.push(...b); }, close: async () => { state.closed = true; }, abort: async () => { state.aborted = true; } }) };
    };
    return { got, state };
  }
  it('writes the stream into the chosen file', async () => {
    const p = picker();
    await webExporter().saveStream('a.pnote', 'application/x-pnote-backup', async (s) => { await s.write(new Uint8Array([1, 2])); await s.close(); });
    expect(p.got).toEqual([1, 2]);
    expect(p.state).toMatchObject({ closed: true, aborted: false, name: 'a.pnote' });
  });
  it('aborts the file when writing fails', async () => {
    const p = picker();
    await expect(webExporter().saveStream('a.pnote', 'x', async () => { throw new Error('disk'); })).rejects.toThrow('disk');
    expect(p.state).toMatchObject({ closed: false, aborted: true });
  });
});
