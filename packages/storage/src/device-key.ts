/** Hardware-backed key protection (Keychain, Keystore, DPAPI). Web has none. */
export interface DeviceKeyProvider {
  readonly available: boolean;
  wrap(b: Uint8Array): Promise<Uint8Array>;
  unwrap(b: Uint8Array): Promise<Uint8Array>;
}

export const WebNoDeviceKey: DeviceKeyProvider = {
  available: false,
  wrap: async (b) => b,
  unwrap: async (b) => b,
};

/** The hardware key that wrapped a profile is gone or no longer valid (app reinstalled, keystore reset). */
export class DeviceKeyMissing extends Error {
  constructor() { super('device key is missing'); this.name = 'DeviceKeyMissing'; }
}
