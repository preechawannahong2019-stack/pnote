import type { BlobSource } from './blob-store';
import { createChunkDecryptor, createChunkEncryptor, deriveBackupKey, KDF_PARAMS, randomBytes, TamperedError } from './crypto';

/**
 * .pnote file:  "PNOTE1\n" · u32 LE header length · header JSON (plaintext) · encrypted stream.
 * The encrypted stream (streaming AES-GCM chunks, header bytes as AAD context) carries records:
 *   u16 LE path length · path (UTF-8) · u64 LE size · data      …and a final record with path length 0.
 * No compression: the large files (PDF, images) are already compressed.
 */
export interface BackupHeader {
  format: 'pnote'; version: 1; kind: 'document' | 'profile'; createdAt: number;
  kdf: { alg: 'argon2id'; memoryKiB: number; iterations: number; parallelism: number; salt: string };
  verifier: string;
}
export interface BackupSink { write(bytes: Uint8Array): Promise<void>; close(): Promise<void>; abort(): Promise<void> }
export interface EntrySink { write(chunk: Uint8Array): Promise<void>; end(): Promise<void> }

export class BackupWrongPassword extends Error { constructor() { super('wrong backup password'); this.name = 'BackupWrongPassword'; } }
export class BackupCorrupt extends Error { constructor(m = 'backup file is damaged or was modified') { super(m); this.name = 'BackupCorrupt'; } }
export class BackupUnsupported extends Error { constructor(m = 'not a supported PNote backup') { super(m); this.name = 'BackupUnsupported'; } }
export class WeakBackupPassword extends Error { constructor() { super(`backup password must be at least ${MIN_BACKUP_PASSWORD} characters`); this.name = 'WeakBackupPassword'; } }

export const MIN_BACKUP_PASSWORD = 10;
const MAGIC = new TextEncoder().encode('PNOTE1\n');
const PIECE = 1_048_576;
const VERIFIER_TEXT = new TextEncoder().encode('pnote-backup-v1');
const VERIFIER_AAD = new TextEncoder().encode('pnote-verifier');

const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const ab = (b: Uint8Array) => b as Uint8Array<ArrayBuffer>;

function recordHead(path: string, size: number): Uint8Array {
  const p = new TextEncoder().encode(path);
  const out = new Uint8Array(2 + p.length + 8);
  const v = new DataView(out.buffer);
  v.setUint16(0, p.length, true);
  out.set(p, 2);
  v.setBigUint64(2 + p.length, BigInt(size), true);
  return out;
}

export class BackupWriter {
  private constructor(private sink: BackupSink, private enc: ReturnType<typeof createChunkEncryptor>) {}

  static async create(sink: BackupSink, kind: BackupHeader['kind'], password: string): Promise<BackupWriter> {
    if (password.length < MIN_BACKUP_PASSWORD) throw new WeakBackupPassword();
    const salt = randomBytes(16);
    const kdf = { alg: 'argon2id' as const, memoryKiB: KDF_PARAMS.memoryKiB, iterations: KDF_PARAMS.iterations, parallelism: KDF_PARAMS.parallelism, salt: b64(salt) };
    const key = await deriveBackupKey(password, salt, kdf);
    const iv = randomBytes(12);
    const v = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: ab(iv), additionalData: ab(VERIFIER_AAD) }, key, ab(VERIFIER_TEXT)));
    const header: BackupHeader = { format: 'pnote', version: 1, kind, createdAt: Date.now(), kdf, verifier: b64(new Uint8Array([...iv, ...v])) };
    const hb = new TextEncoder().encode(JSON.stringify(header));
    const pre = new Uint8Array(MAGIC.length + 4 + hb.length);
    pre.set(MAGIC, 0);
    new DataView(pre.buffer).setUint32(MAGIC.length, hb.length, true);
    pre.set(hb, MAGIC.length + 4);
    await sink.write(pre);
    return new BackupWriter(sink, createChunkEncryptor(key, hb));
  }

  private async emit(plain: Uint8Array): Promise<void> {
    for (const c of await this.enc.push(plain)) await this.sink.write(c);
  }

  /** Streams one file: a Uint8Array or a BlobSource read 1 MB at a time. */
  async addFile(path: string, data: Uint8Array | BlobSource, _compress = false): Promise<void> {
    const bytes = ArrayBuffer.isView(data) ? (data as Uint8Array) : null; // not instanceof: arrays from another realm (workers, jsdom) fail it
    const size = bytes ? bytes.length : (data as BlobSource).size;
    await this.emit(recordHead(path, size));
    for (let off = 0; off < size; off += PIECE) {
      const end = Math.min(size, off + PIECE);
      await this.emit(bytes ? bytes.subarray(off, end) : await (data as BlobSource).slice(off, end));
    }
  }

  async close(): Promise<void> {
    await this.emit(new Uint8Array(2)); // path length 0: end of records
    for (const c of await this.enc.finish()) await this.sink.write(c);
    await this.sink.close();
  }

  async abort(): Promise<void> { await this.sink.abort(); }
}

export class BackupReader {
  private constructor(private src: BlobSource, readonly header: BackupHeader, private headerBytes: Uint8Array, private key: CryptoKey, private bodyStart: number) {}

  static async open(src: BlobSource, password: string): Promise<BackupReader> {
    const head = await src.slice(0, Math.min(src.size, 65_536));
    if (head.length < MAGIC.length + 4 || MAGIC.some((m, i) => head[i] !== m)) throw new BackupUnsupported();
    const len = new DataView(head.buffer, head.byteOffset, head.byteLength).getUint32(MAGIC.length, true);
    const start = MAGIC.length + 4;
    if (start + len > head.length) throw new BackupCorrupt('header is damaged');
    const hb = head.slice(start, start + len);
    let header: BackupHeader;
    try { header = JSON.parse(new TextDecoder().decode(hb)) as BackupHeader; } catch { throw new BackupCorrupt('header is damaged'); }
    if (header.format !== 'pnote' || header.version !== 1) throw new BackupUnsupported();
    const key = await deriveBackupKey(password, unb64(header.kdf.salt), header.kdf);
    const v = unb64(header.verifier);
    try {
      await crypto.subtle.decrypt({ name: 'AES-GCM', iv: v.slice(0, 12), additionalData: ab(VERIFIER_AAD) }, key, v.slice(12));
    } catch {
      throw new BackupWrongPassword();
    }
    return new BackupReader(src, header, hb, key, start + len);
  }

  /** Streams every file to the sink returned by onFile. Throws BackupCorrupt if anything fails to authenticate. */
  async entries(onFile: (path: string) => EntrySink): Promise<void> {
    const dec = createChunkDecryptor(this.key, this.headerBytes);
    let pending: Uint8Array = new Uint8Array(0);
    let current: { sink: EntrySink; left: number } | null = null;
    let done = false;

    const take = (n: number) => { const out = pending.subarray(0, n); pending = pending.subarray(n); return out; };
    const feed = async (plain: Uint8Array) => {
      if (pending.length) { const j = new Uint8Array(pending.length + plain.length); j.set(pending, 0); j.set(plain, pending.length); pending = j; } else pending = plain;
      for (;;) {
        if (done) { if (pending.length) throw new BackupCorrupt('data after the end'); return; }
        if (current) {
          const n = Math.min(current.left, pending.length);
          if (n) { await current.sink.write(take(n).slice()); current.left -= n; }
          if (current.left === 0) { await current.sink.end(); current = null; continue; }
          return;
        }
        if (pending.length < 2) return;
        const pl = pending[0] | (pending[1] << 8);
        if (pl === 0) { take(2); done = true; continue; }
        if (pending.length < 2 + pl + 8) return;
        take(2);
        const path = new TextDecoder().decode(take(pl));
        const hv = take(8);
        const size = Number(new DataView(hv.buffer, hv.byteOffset, 8).getBigUint64(0, true));
        current = { sink: onFile(path), left: size };
      }
    };

    try {
      for (let off = this.bodyStart; off < this.src.size; off += PIECE) {
        for (const p of await dec.push(await this.src.slice(off, Math.min(this.src.size, off + PIECE)))) await feed(p);
      }
      for (const p of await dec.finish()) await feed(p);
    } catch (e) {
      if (e instanceof TamperedError) throw new BackupCorrupt();
      throw e;
    }
    if (!done || current) throw new BackupCorrupt('backup ends early');
  }
}
