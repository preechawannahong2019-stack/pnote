import type { StorageAdapter } from '@pnote/storage/adapter';
import { WebNoDeviceKey, type DeviceKeyProvider } from '@pnote/storage/device-key';
import { IndexedDbAdapter } from '@pnote/storage/idb-adapter';
import { setLifecycle, webLifecycle, type Lifecycle } from './lifecycle';

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
}

export async function createPlatformServices(kind: PlatformKind = platformKind()): Promise<PlatformServices> {
  const services = kind === 'web'
    ? { kind, adapter: new IndexedDbAdapter('pnote'), device: WebNoDeviceKey, lifecycle: webLifecycle() }
    : await (await import('./native')).createNativeServices(kind);
  setLifecycle(services.lifecycle);
  return services;
}
