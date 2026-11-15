import type { MiniFs } from '../../src/fs-adapter';

/** In-memory stand-in for @capacitor/filesystem (Directory.Data), base64 file contents like the real plugin. */
export function memoryFs(): MiniFs & { files: Map<string, string>; failNextRename: boolean; excluded: string[] } {
  const files = new Map<string, string>();
  const fs = {
    files,
    failNextRename: false,
    excluded: [] as string[],
    async readFile({ path }: { path: string }) {
      const d = files.get(path);
      if (d === undefined) throw Object.assign(new Error('File does not exist.'), { code: 'OS-PLUG-FILE-0008' });
      return { data: d };
    },
    async writeFile({ path, data }: { path: string; data: string; recursive: true }) { files.set(path, data); },
    async rename({ from, to }: { from: string; to: string }) {
      if (fs.failNextRename) { fs.failNextRename = false; throw new Error('crash'); }
      const d = files.get(from);
      if (d === undefined) throw new Error('missing');
      files.set(to, d);
      files.delete(from);
    },
    async deleteFile({ path }: { path: string }) {
      if (!files.delete(path)) throw new Error('File does not exist.');
    },
    async readdir({ path }: { path: string }) {
      const prefix = path.endsWith('/') ? path : `${path}/`;
      const names = new Map<string, 'file' | 'directory'>();
      for (const k of files.keys()) {
        if (!k.startsWith(prefix)) continue;
        const rest = k.slice(prefix.length);
        const [head, ...tail] = rest.split('/');
        names.set(head, tail.length ? 'directory' : 'file');
      }
      if (!names.size && ![...files.keys()].some((k) => k.startsWith(prefix))) throw new Error('Directory does not exist.');
      return { files: [...names].map(([name, type]) => ({ name, type })) };
    },
    async excludeFromBackup(path: string) { fs.excluded.push(path); },
  };
  return fs;
}
