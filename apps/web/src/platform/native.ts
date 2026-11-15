import { App as CapApp } from '@capacitor/app';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { PnoteCapture, PnoteIncoming, PnoteSecure } from '@pnote/capacitor-pnote';
import { IncomingFiles } from './incoming';
import { nativeCapture } from './capture';
import { nativeLifecycle } from './lifecycle';
import { FilesystemAdapter } from '@pnote/storage/fs-adapter';
import type { PlatformKind, PlatformServices } from './index';
import { capacitorFs } from './capacitor-fs';
import { NativeDeviceKey } from './native-key';

/** Native services: files in the app's private data directory (excluded from backups), keys bound to the device's secure hardware. */
export async function createNativeServices(kind: Exclude<PlatformKind, 'web'>): Promise<PlatformServices> {
  const adapter = new FilesystemAdapter(capacitorFs((path) => PnoteSecure.excludeFromBackup({ path })));
  const cacheFiles = {
    read: async (path: string) => {
      const r = await Filesystem.readFile({ path, directory: Directory.Cache });
      return typeof r.data === 'string' ? Uint8Array.from(atob(r.data), (c) => c.charCodeAt(0)) : new Uint8Array(await r.data.arrayBuffer());
    },
    remove: (path: string) => Filesystem.deleteFile({ path, directory: Directory.Cache }),
  };
  return {
    kind, adapter, device: await NativeDeviceKey.create(PnoteSecure), lifecycle: nativeLifecycle(CapApp),
    capture: nativeCapture(PnoteCapture, cacheFiles),
    incoming: new IncomingFiles({
      onFile: (cb) => { const h = PnoteIncoming.addListener('file', cb); return () => { void h.then((x) => x.remove()); }; },
      read: async (path) => new Blob([(await cacheFiles.read(path)) as Uint8Array<ArrayBuffer>]),
      remove: cacheFiles.remove,
    }),
  };
}
