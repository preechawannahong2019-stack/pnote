import type { StorageAdapter } from '@pnote/storage/adapter';
import { WebNoDeviceKey, type DeviceKeyProvider } from '@pnote/storage/device-key';
import { IndexedDbAdapter } from '@pnote/storage/idb-adapter';
import { setLifecycle, webLifecycle, type Lifecycle } from './lifecycle';
import { webCaptureFallback, type WebCapture } from './capture';
import { IncomingFiles, noIncoming } from './incoming';
import { webExporter, type FileExporter } from './exporter';

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
  incoming: IncomingFiles;
  exporter: FileExporter;
}

let services: PlatformServices | null = null;
/** The services created at start-up (web defaults before that, e.g. in tests). */
const fallbackIncoming = new IncomingFiles(noIncoming);
let fallbackExporter: FileExporter | null = null;
export function currentServices(): Pick<PlatformServices, 'capture' | 'incoming' | 'exporter'> {
  return services ?? { capture: webCaptureFallback, incoming: fallbackIncoming, exporter: (fallbackExporter ??= webExporter()) };
}

export async function createPlatformServices(kind: PlatformKind = platformKind()): Promise<PlatformServices> {
  const s: PlatformServices = kind === 'web'
    ? { kind, adapter: new IndexedDbAdapter('pnote'), device: WebNoDeviceKey, lifecycle: webLifecycle(), capture: webCaptureFallback, incoming: fallbackIncoming, exporter: webExporter() }
    : await (await import('./native')).createNativeServices(kind);
  setLifecycle(s.lifecycle);
  services = s;
  return s;
}
