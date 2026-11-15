import { FilesystemAdapter } from '@pnote/storage/fs-adapter';
import { WebNoDeviceKey } from '@pnote/storage/device-key';
import type { PlatformKind, PlatformServices } from './index';
import { capacitorFs } from './capacitor-fs';

/** Native services: files in the app's private data directory. Device keys come with Task 3. */
export async function createNativeServices(kind: Exclude<PlatformKind, 'web'>): Promise<PlatformServices> {
  return { kind, adapter: new FilesystemAdapter(capacitorFs()), device: WebNoDeviceKey };
}
