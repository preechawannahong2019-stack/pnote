import type { StorageAdapter } from '@pnote/storage/adapter';
import { WebNoDeviceKey, type DeviceKeyProvider } from '@pnote/storage/device-key';
import { IndexedDbAdapter } from '@pnote/storage/idb-adapter';
import { setLifecycle, webLifecycle, type Lifecycle } from './lifecycle';
import { webCaptureFallback, type WebCapture } from './capture';

export type PlatformKind = 'web' | 'android' | 'ios';

interface CapacitorLike { isNativePlatform(): boolean; getPlatform(): string }

export function platformKind(cap: CapacitorLike | undefined = (globalThis as { Capacitor?: CapacitorLike }).Capacitor): PlatformKind {
  if (!cap?.isNativePlatform()) return 'web';
  const p = cap.getPlatform();
  return p === 'android' || p === 'ios' ? p : 'web';
}

/** Everything that differs between the PWA and the native apps. Later tasks add capture, incoming files, export and lifecycle. */
export interface PlatformServices {
  kind: PlatformKind;
  adapter: StorageAdapter;
  device: DeviceKeyProvider;
  lifecycle: Lifecycle;
  capture: WebCapture;
}

let services: PlatformServices | null = null;
/** The services created at start-up (web defaults before that, e.g. in tests). */
export function currentServices(): Pick<PlatformServices, 'capture'> { return services ?? { capture: webCaptureFallback }; }

export async function createPlatformServices(kind: PlatformKind = platformKind()): Promise<PlatformServices> {
  const s: PlatformServices = kind === 'web'
    ? { kind, adapter: new IndexedDbAdapter('pnote'), device: WebNoDeviceKey, lifecycle: webLifecycle(), capture: webCaptureFallback }
    : await (await import('./native')).createNativeServices(kind);
  setLifecycle(s.lifecycle);
  services = s;
  return s;
}
