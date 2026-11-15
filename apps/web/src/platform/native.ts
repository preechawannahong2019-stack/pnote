import type { PlatformKind, PlatformServices } from './index';
import { IndexedDbAdapter } from '@pnote/storage/idb-adapter';
import { WebNoDeviceKey } from '@pnote/storage/device-key';

/** Native services; storage and device keys are replaced by Tasks 2–3. */
export async function createNativeServices(kind: Exclude<PlatformKind, 'web'>): Promise<PlatformServices> {
  return { kind, adapter: new IndexedDbAdapter('pnote'), device: WebNoDeviceKey };
}
