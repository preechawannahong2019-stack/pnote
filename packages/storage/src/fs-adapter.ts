import type { StorageAdapter } from './adapter';

/** The subset of @capacitor/filesystem (Directory.Data) the adapter uses, so tests can pass an in-memory fake. */
export interface MiniFs {
  readFile(o: { path: string }): Promise<{ data: string }>; // base64
  writeFile(o: { path: string; data: string; recursive: true }): Promise<void>;
  rename(o: { from: string; to: string }): Promise<void>;
  deleteFile(o: { path: string }): Promise<void>;
  readdir(o: { path: string }): Promise<{ files: { name: string; type: 'file' | 'directory' }[] }>;
  /** iOS: mark the directory isExcludedFromBackup (via PnoteSecure). Android excludes app data in the manifest. */
  excludeFromBackup?(path: string): Promise<void>;
}

const TMP = '.tmp';
const SAFE = /[A-Za-z0-9._\-/]/;

/** '/p1/documents/a b' → 'pnote/p1/documents/a%20b' (percent-encode every UTF-8 byte outside [A-Za-z0-9._-/]). */
export function encodeKey(path: string, root = 'pnote'): string {
  let out = '';
  for (const ch of path) {
    if (SAFE.test(ch)) { out += ch; continue; }
    for (const b of new TextEncoder().encode(ch)) out += `%${b.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return `${root}${out.startsWith('/') ? '' : '/'}${out}`;
}

function decodeKey(file: string, root: string): string {
  return decodeURIComponent(file.slice(root.length));
}

function toBase64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Stores each key as a file under the app's data directory; writes go to a temp file and are renamed into place. */
export class FilesystemAdapter implements StorageAdapter {
  private prepared: Promise<void> | null = null;

  constructor(private fs: MiniFs, private root = 'pnote') {}

  private prepare(): Promise<void> {
    return (this.prepared ??= (async () => { await this.fs.excludeFromBackup?.(this.root); })());
  }

  async get(path: string): Promise<Uint8Array | null> {
    try {
      return fromBase64((await this.fs.readFile({ path: encodeKey(path, this.root) })).data);
    } catch {
      return null;
    }
  }

  async put(path: string, data: Uint8Array): Promise<void> {
    await this.prepare();
    const file = encodeKey(path, this.root);
    await this.fs.writeFile({ path: file + TMP, data: toBase64(data), recursive: true });
    await this.fs.rename({ from: file + TMP, to: file });
  }

  async delete(path: string): Promise<void> {
    await this.fs.deleteFile({ path: encodeKey(path, this.root) }).catch(() => {});
  }

  async list(prefix: string): Promise<string[]> {
    const out: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      let entries: { name: string; type: 'file' | 'directory' }[];
      try { entries = (await this.fs.readdir({ path: dir })).files; } catch { return; }
      for (const e of entries) {
        const full = `${dir}/${e.name}`;
        if (e.type === 'directory') await walk(full);
        else if (!e.name.endsWith(TMP)) out.push(decodeKey(full, this.root));
      }
    };
    // walk from the deepest directory the prefix names, then filter
    const enc = encodeKey(prefix, this.root);
    const dir = enc.slice(0, enc.lastIndexOf('/')) || this.root;
    await walk(dir);
    return out.filter((k) => k.startsWith(prefix)).sort();
  }
}
