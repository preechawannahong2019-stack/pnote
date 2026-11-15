export interface FileExporter {
  canShare: boolean;
  save(name: string, bytes: Uint8Array, mime?: string): Promise<void>;
  share(name: string, bytes: Uint8Array, mime?: string): Promise<void>;
  /** For large files (backups): `write` streams into the sink; nothing is offered if it throws or aborts. */
  saveStream(name: string, mime: string, write: (sink: StreamSink) => Promise<void>): Promise<void>;
  shareStream(name: string, mime: string, write: (sink: StreamSink) => Promise<void>): Promise<void>;
}
export interface StreamSink { write(bytes: Uint8Array): Promise<void>; close(): Promise<void>; abort(): Promise<void> }

const safeName = (name: string) => name.replace(/[\\/:*?"<>|]/g, '_');
const isCancel = (e: unknown) => {
  const msg = String((e as Error)?.message ?? e).toLowerCase();
  return (e as Error)?.name === 'AbortError' || msg.includes('cancel');
};

/** Browser: download link, or the Web Share API where it can share files. */
function collector() {
  const parts: Uint8Array[] = [];
  let aborted = false;
  const sink: StreamSink = { write: async (b) => { parts.push(b.slice()); }, close: async () => {}, abort: async () => { aborted = true; parts.length = 0; } };
  return { sink, parts, get aborted() { return aborted; } };
}

export function webExporter(): FileExporter {
  const probe = typeof navigator !== 'undefined' && !!navigator.canShare?.({ files: [new File([], 'x.pdf', { type: 'application/pdf' })] });
  return {
    canShare: probe,
    async save(name, bytes, mime = 'application/pdf') {
      const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime }));
      const a = Object.assign(document.createElement('a'), { href: url, download: safeName(name) });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    },
    async share(name, bytes, mime = 'application/pdf') {
      try {
        await navigator.share({ files: [new File([bytes as Uint8Array<ArrayBuffer>], safeName(name), { type: mime })], title: name });
      } catch (e) {
        if (!isCancel(e)) throw e;
      }
    },
    async saveStream(name, mime, write) {
      const c = collector(); // the browser may page a large Blob to disk
      await write(c.sink);
      if (c.aborted) return;
      const url = URL.createObjectURL(new Blob(c.parts as Uint8Array<ArrayBuffer>[], { type: mime }));
      const a = Object.assign(document.createElement('a'), { href: url, download: safeName(name) });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    },
    async shareStream(name, mime, write) {
      const c = collector();
      await write(c.sink);
      if (c.aborted) return;
      try {
        await navigator.share({ files: [new File(c.parts as Uint8Array<ArrayBuffer>[], safeName(name), { type: mime })], title: name });
      } catch (e) {
        if (!isCancel(e)) throw e;
      }
    },
  };
}

export interface NativeExportDeps {
  writeCache(name: string, bytes: Uint8Array): Promise<string>; // returns a file uri
  createCache(name: string): Promise<{ uri: string; append(bytes: Uint8Array): Promise<void> }>;
  remove(uri: string): Promise<void>;
  share(o: { files: string[]; title: string }): Promise<void>;
  saveToFiles(uri: string): Promise<void>;
}

/** Native: the file exists in the app cache only while the share/save sheet is open, then it is deleted whatever happened. */
export function nativeExporter(d: NativeExportDeps): FileExporter {
  const withTemp = async (name: string, bytes: Uint8Array, use: (uri: string) => Promise<void>) => {
    const uri = await d.writeCache(safeName(name), bytes);
    try {
      await use(uri);
    } catch (e) {
      if (!isCancel(e)) throw e;
    } finally {
      await d.remove(uri).catch(() => {});
    }
  };
  const streamTemp = async (name: string, write: (sink: StreamSink) => Promise<void>, use: (uri: string) => Promise<void>) => {
    const f = await d.createCache(safeName(name));
    let aborted = false;
    try {
      await write({ write: (b) => f.append(b), close: async () => {}, abort: async () => { aborted = true; } });
      if (!aborted) await use(f.uri);
    } catch (e) {
      if (!isCancel(e)) throw e;
    } finally {
      await d.remove(f.uri).catch(() => {});
    }
  };
  return {
    canShare: true,
    saveStream: (name, _mime, write) => streamTemp(name, write, (uri) => d.saveToFiles(uri)),
    shareStream: (name, _mime, write) => streamTemp(name, write, (uri) => d.share({ files: [uri], title: name })),
    save: (name, bytes) => withTemp(name, bytes, (uri) => d.saveToFiles(uri)),
    share: (name, bytes) => withTemp(name, bytes, (uri) => d.share({ files: [uri], title: name })),
  };
}
