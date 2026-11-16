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

export interface PnoteCapturePlugin {
  /** Shows the page in a private browser sheet; resolves when the user taps "บันทึกหน้านี้". Paths are relative to the app cache directory.
   *  Rejects with code 'CANCELLED' | 'TIMEOUT' | 'LOAD_FAILED' | 'INVALID_URL'. */
  capture(o: { url: string }): Promise<{
    requestedUrl: string; finalUrl: string; title: string; userAgent: string; capturedAt: number; timeZone: string;
    pdfPath: string; pngPath: string; archivePath: string; archiveType: 'mht' | 'webarchive';
  }>;
}

export const PnoteCapture = registerPlugin<PnoteCapturePlugin>('PnoteCapture');

import type { PluginListenerHandle } from '@capacitor/core';

export interface PnoteIncomingPlugin {
  /** A file shared to / opened with PNote, copied into the app cache (path relative to Directory.Cache). Retained until a listener is added. */
  addListener(event: 'file', cb: (f: { name: string; mime: string; path: string }) => void): Promise<PluginListenerHandle>;
}

export const PnoteIncoming = registerPlugin<PnoteIncomingPlugin>('PnoteIncoming');
