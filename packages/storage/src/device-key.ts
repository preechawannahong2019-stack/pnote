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
