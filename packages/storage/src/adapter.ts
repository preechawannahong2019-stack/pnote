export interface StorageAdapter {
  get(path: string): Promise<Uint8Array | null>;
  put(path: string, data: Uint8Array): Promise<void>;
  delete(path: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
}

export class MemoryAdapter implements StorageAdapter {
  private files = new Map<string, Uint8Array>();

  async get(path: string): Promise<Uint8Array | null> {
    const f = this.files.get(path);
    return f ? f.slice() : null;
  }
  async put(path: string, data: Uint8Array): Promise<void> {
    this.files.set(path, data.slice());
  }
  async delete(path: string): Promise<void> {
    this.files.delete(path);
  }
  async list(prefix: string): Promise<string[]> {
    return [...this.files.keys()].filter((k) => k.startsWith(prefix)).sort();
  }
}
