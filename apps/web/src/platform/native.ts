import { PnoteSecure } from '@pnote/capacitor-pnote';
import { FilesystemAdapter } from '@pnote/storage/fs-adapter';
import type { PlatformKind, PlatformServices } from './index';
import { capacitorFs } from './capacitor-fs';
import { NativeDeviceKey } from './native-key';

/** Native services: files in the app's private data directory (excluded from backups), keys bound to the device's secure hardware. */
export async function createNativeServices(kind: Exclude<PlatformKind, 'web'>): Promise<PlatformServices> {
  const adapter = new FilesystemAdapter(capacitorFs((path) => PnoteSecure.excludeFromBackup({ path })));
  return { kind, adapter, device: await NativeDeviceKey.create(PnoteSecure) };
}
