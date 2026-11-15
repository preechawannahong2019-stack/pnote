import type { Id } from '@pnote/core/types';
import type { StorageAdapter } from './adapter';
import { decryptBytes, encryptBytes } from './crypto';

/** Encrypts everything it writes; every path lives under /<profileId>/. */
export class EncryptedStore {
  private readonly root: string;

  constructor(private adapter: StorageAdapter, private key: CryptoKey, readonly profileId: Id) {
    this.root = `/${profileId}/`;
  }

  private path(rel: string): string {
    if (rel.startsWith('/') || rel.split('/').some((p) => p === '..' || p === '.')) throw new Error(`invalid path: ${rel}`);
    return this.root + rel;
  }

  async getBytes(rel: string): Promise<Uint8Array | null> {
    const path = this.path(rel);
    const raw = await this.adapter.get(path);
    return raw ? decryptBytes(this.key, raw, new TextEncoder().encode(path)) : null;
  }
  /** The path is part of the AAD, so a file copied over another path fails to decrypt. */
  async putBytes(rel: string, b: Uint8Array): Promise<void> {
    const path = this.path(rel);
    await this.adapter.put(path, await encryptBytes(this.key, b, new TextEncoder().encode(path)));
  }
  async getJSON<T>(rel: string): Promise<T | null> {
    const b = await this.getBytes(rel);
    return b ? (JSON.parse(new TextDecoder().decode(b)) as T) : null;
  }
  async putJSON(rel: string, v: unknown): Promise<void> {
    await this.putBytes(rel, new TextEncoder().encode(JSON.stringify(v)));
  }
  async delete(rel: string): Promise<void> {
    await this.adapter.delete(this.path(rel));
  }
  async list(relPrefix: string): Promise<string[]> {
    const all = await this.adapter.list(relPrefix ? this.path(relPrefix) : this.root);
    return all.map((p) => p.slice(this.root.length));
  }
}
