export interface FileExporter {
  canShare: boolean;
  save(name: string, bytes: Uint8Array, mime?: string): Promise<void>;
  share(name: string, bytes: Uint8Array, mime?: string): Promise<void>;
}

const safeName = (name: string) => name.replace(/[\\/:*?"<>|]/g, '_');
const isCancel = (e: unknown) => {
  const msg = String((e as Error)?.message ?? e).toLowerCase();
  return (e as Error)?.name === 'AbortError' || msg.includes('cancel');
};

/** Browser: download link, or the Web Share API where it can share files. */
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
  };
}

export interface NativeExportDeps {
  writeCache(name: string, bytes: Uint8Array): Promise<string>; // returns a file uri
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
  return {
    canShare: true,
    save: (name, bytes) => withTemp(name, bytes, (uri) => d.saveToFiles(uri)),
    share: (name, bytes) => withTemp(name, bytes, (uri) => d.share({ files: [uri], title: name })),
  };
}
