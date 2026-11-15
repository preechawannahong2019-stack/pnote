import { Directory, Filesystem } from '@capacitor/filesystem';
import type { MiniFs } from '@pnote/storage/fs-adapter';

/** @capacitor/filesystem in the app's private data directory, shaped as MiniFs. */
export function capacitorFs(excludeFromBackup?: (path: string) => Promise<void>): MiniFs {
  const directory = Directory.Data;
  return {
    async readFile({ path }) {
      const r = await Filesystem.readFile({ path, directory });
      return { data: typeof r.data === 'string' ? r.data : await blobToBase64(r.data) };
    },
    async writeFile({ path, data }) { await Filesystem.writeFile({ path, data, directory, recursive: true }); },
    async rename({ from, to }) { await Filesystem.rename({ from, to, directory, toDirectory: directory }); },
    async deleteFile({ path }) { await Filesystem.deleteFile({ path, directory }); },
    async readdir({ path }) {
      const r = await Filesystem.readdir({ path, directory });
      return { files: r.files.map((f) => ({ name: f.name, type: f.type })) };
    },
    excludeFromBackup,
  };
}

async function blobToBase64(b: Blob): Promise<string> {
  const bytes = new Uint8Array(await b.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
