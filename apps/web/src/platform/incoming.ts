/** A file another app handed to PNote, copied into the app cache by the native side. */
export interface IncomingFile { name: string; mime: string; path: string }

export interface IncomingSource {
  onFile(cb: (f: IncomingFile) => void): () => void;
  read(path: string): Promise<Blob>;
  remove(path: string): Promise<void>;
}

/** Holds incoming files until a profile is unlocked and the user confirms where they go. */
export class IncomingFiles {
  private queue: IncomingFile[] = [];
  private listeners = new Set<() => void>();

  constructor(private source: IncomingSource) {
    source.onFile((f) => { this.queue = [...this.queue, f]; this.emit(); });
  }

  get pending(): IncomingFile[] { return this.queue; }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(): void { this.listeners.forEach((cb) => cb()); }

  private drop(f: IncomingFile): void {
    this.queue = this.queue.filter((x) => x.path !== f.path); // by path: UI frameworks may hand back proxies
    this.emit();
  }

  async take(f: IncomingFile): Promise<Blob> {
    try {
      return await this.source.read(f.path);
    } finally {
      await this.source.remove(f.path).catch(() => {});
      this.drop(f);
    }
  }

  async discard(f: IncomingFile): Promise<void> {
    await this.source.remove(f.path).catch(() => {});
    this.drop(f);
  }
}

/** The web build receives no files from other apps. */
export const noIncoming: IncomingSource = { onFile: () => () => {}, read: async () => new Blob(), remove: async () => {} };
