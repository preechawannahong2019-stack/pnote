import { registerPlugin } from '@capacitor/core';

export interface PnoteSecurePlugin {
  status(): Promise<{ available: boolean; hardware: 'strongbox' | 'tee' | 'secure-enclave' | 'keychain' }>;
  wrap(o: { data: string }): Promise<{ data: string }>;
  /** rejects with code 'KEY_MISSING' | 'KEY_INVALID' | 'DECRYPT_FAILED' */
  unwrap(o: { data: string }): Promise<{ data: string }>;
  /** iOS: mark <Documents>/<path> isExcludedFromBackup. Android: no-op (manifest excludes app data). */
  excludeFromBackup(o: { path: string }): Promise<void>;
}

export const PnoteSecure = registerPlugin<PnoteSecurePlugin>('PnoteSecure');
