import type { StorageAdapter } from './adapter';

const STORE = 'files';

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export class IndexedDbAdapter implements StorageAdapter {
  private db: Promise<IDBDatabase>;

  constructor(dbName = 'pnote') {
    this.db = new Promise((resolve, reject) => {
      const open = indexedDB.open(dbName, 1);
      open.onupgradeneeded = () => open.result.createObjectStore(STORE);
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
  }

  private async store(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    return (await this.db).transaction(STORE, mode).objectStore(STORE);
  }

  async get(path: string): Promise<Uint8Array | null> {
    const v = await req((await this.store('readonly')).get(path));
    return v ? new Uint8Array(v as ArrayBuffer) : null;
  }
  async put(path: string, data: Uint8Array): Promise<void> {
    const copy = data.slice().buffer;
    const s = await this.store('readwrite');
    await req(s.put(copy, path));
  }
  async delete(path: string): Promise<void> {
    await req((await this.store('readwrite')).delete(path));
  }
  async list(prefix: string): Promise<string[]> {
    const range = IDBKeyRange.bound(prefix, prefix + '￿');
    const keys = await req((await this.store('readonly')).getAllKeys(range));
    return (keys as string[]).sort();
  }
}
