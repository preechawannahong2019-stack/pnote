import { DeviceKeyMissing, type DeviceKeyProvider } from '@pnote/storage/device-key';

/** JS ⇄ native contract of the PnoteSecure plugin (Android Keystore / iOS Secure Enclave). */
export interface PnoteSecure {
  status(): Promise<{ available: boolean; hardware: 'strongbox' | 'tee' | 'secure-enclave' | 'keychain' }>;
  wrap(o: { data: string }): Promise<{ data: string }>;
  /** rejects with code 'KEY_MISSING' | 'KEY_INVALID' | 'DECRYPT_FAILED' */
  unwrap(o: { data: string }): Promise<{ data: string }>;
  excludeFromBackup(o: { path: string }): Promise<void>;
}

const b64 = (b: Uint8Array) => { let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export class NativeDeviceKey implements DeviceKeyProvider {
  private constructor(private plugin: PnoteSecure, readonly available: boolean, readonly hardware: string) {}

  static async create(plugin: PnoteSecure): Promise<NativeDeviceKey> {
    const s = await plugin.status();
    return new NativeDeviceKey(plugin, s.available, s.hardware);
  }

  async wrap(b: Uint8Array): Promise<Uint8Array> {
    return unb64((await this.plugin.wrap({ data: b64(b) })).data);
  }

  async unwrap(b: Uint8Array): Promise<Uint8Array> {
    try {
      return unb64((await this.plugin.unwrap({ data: b64(b) })).data);
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'KEY_MISSING' || code === 'KEY_INVALID') throw new DeviceKeyMissing();
      throw e;
    }
  }
}
