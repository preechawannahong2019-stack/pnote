import { createSHA256 } from 'hash-wasm';
import type { EncryptedStore } from './encrypted-store';

export const BLOB_CHUNK = 1_048_576;
const CACHE_CHUNKS = 8;

export interface BlobManifest { size: number; chunks: number; sha256: string; mime: string }
export interface BlobSource { size: number; slice(start: number, end: number): Promise<Uint8Array> }

/** Reads a File/Blob one slice at a time (never the whole file). */
export function fileSource(f: Blob): BlobSource {
  return { size: f.size, slice: async (s, e) => new Uint8Array(await f.slice(s, e).arrayBuffer()) };
}

const chunkName = (rel: string, i: number) => `${rel}/${String(i).padStart(6, '0')}`;

/** Large binary data stored as independently encrypted 1 MB chunks, written manifest-last. */
export class BlobStore {
  private cache = new Map<string, Uint8Array>();

  constructor(private store: EncryptedStore) {}

  async put(rel: string, src: BlobSource, mime: string, onProgress?: (done: number, total: number) => void): Promise<BlobManifest> {
    const hasher = await createSHA256();
    hasher.init();
    const chunks = Math.max(1, Math.ceil(src.size / BLOB_CHUNK));
    for (let i = 0; i < chunks; i++) {
      const start = i * BLOB_CHUNK;
      const part = await src.slice(start, Math.min(src.size, start + BLOB_CHUNK));
      hasher.update(part);
      await this.store.putBytes(chunkName(rel, i), part);
      onProgress?.(start + part.length, src.size);
    }
    const manifest: BlobManifest = { size: src.size, chunks, sha256: hasher.digest('hex'), mime };
    await this.store.putJSON(`${rel}/manifest.json`, manifest);
    return manifest;
  }

  /** Streaming put: write pieces of any size; chunks of BLOB_CHUNK are stored as they fill; close() writes the manifest last. */
  async writer(rel: string, mime: string): Promise<{ write(b: Uint8Array): Promise<void>; close(): Promise<BlobManifest> }> {
    const hasher = await createSHA256();
    hasher.init();
    let buf = new Uint8Array(0);
    let index = 0;
    let size = 0;
    const flush = async (all: boolean) => {
      while (buf.length >= BLOB_CHUNK || (all && (buf.length || index === 0))) {
        const part = buf.slice(0, BLOB_CHUNK);
        buf = buf.slice(part.length);
        await this.store.putBytes(chunkName(rel, index++), part);
        if (!part.length) break;
      }
    };
    return {
      write: async (b) => {
        hasher.update(b);
        size += b.length;
        const j = new Uint8Array(buf.length + b.length); j.set(buf, 0); j.set(b, buf.length); buf = j;
        await flush(false);
      },
      close: async () => {
        await flush(true);
        const manifest: BlobManifest = { size, chunks: Math.max(1, index), sha256: hasher.digest('hex'), mime };
        await this.store.putJSON(`${rel}/manifest.json`, manifest);
        return manifest;
      },
    };
  }

  manifest(rel: string): Promise<BlobManifest | null> {
    return this.store.getJSON<BlobManifest>(`${rel}/manifest.json`);
  }

  private async chunk(rel: string, i: number): Promise<Uint8Array> {
    const key = chunkName(rel, i);
    const hit = this.cache.get(key);
    if (hit) {
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit;
    }
    const b = await this.store.getBytes(key);
    if (!b) throw new Error(`missing chunk ${key}`);
    this.cache.set(key, b);
    while (this.cache.size > CACHE_CHUNKS) this.cache.delete(this.cache.keys().next().value!);
    return b;
  }

  async readRange(rel: string, start: number, end: number): Promise<Uint8Array> {
    const out = new Uint8Array(Math.max(0, end - start));
    for (let i = Math.floor(start / BLOB_CHUNK); i * BLOB_CHUNK < end; i++) {
      const c = await this.chunk(rel, i);
      const cs = i * BLOB_CHUNK;
      const from = Math.max(start, cs) - cs;
      const to = Math.min(end, cs + c.length) - cs;
      if (to > from) out.set(c.subarray(from, to), cs + from - start);
    }
    return out;
  }

  async readAll(rel: string): Promise<Uint8Array> {
    const m = await this.manifest(rel);
    if (!m) throw new Error(`no blob ${rel}`);
    return this.readRange(rel, 0, m.size);
  }

  /** Recompute the SHA-256 chunk by chunk and compare with the manifest. */
  async verify(rel: string): Promise<boolean> {
    const m = await this.manifest(rel);
    if (!m) return false;
    const hasher = await createSHA256();
    hasher.init();
    try {
      for (let i = 0; i < m.chunks; i++) {
        const b = await this.store.getBytes(chunkName(rel, i));
        if (!b) return false;
        hasher.update(b);
      }
    } catch {
      return false; // a chunk that fails to decrypt (moved or modified) is a mismatch
    }
    return hasher.digest('hex') === m.sha256;
  }

  async delete(rel: string): Promise<void> {
    for (const p of await this.store.list(`${rel}/`)) {
      await this.store.delete(p);
      this.cache.delete(p);
    }
  }
}
