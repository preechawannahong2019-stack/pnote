# Stage 3 — Android & iPad apps (Capacitor): device-bound keys, 6-digit PIN, web capture, open-in, native share

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Stage 1–2 app as installable Android and iPadOS apps whose profile keys are bound to the device's secure hardware, unlocked with a 6-digit PIN, that can save a web page from a link as evidence (PDF + screenshot + archive + hashes), receive PDFs/images from other apps, share exports without leaving plaintext behind, and back up / move documents and whole profiles as password-encrypted `.pnote` files (brought forward from Stage 4 so a lost or replaced device does not mean lost data).

**Architecture:** `apps/mobile` is a Capacitor 8 shell around the `apps/web` build. Platform-specific behaviour sits behind small TypeScript interfaces that already exist or are added here (`StorageAdapter`, `DeviceKeyProvider`, `WebCapture`, `IncomingFiles`, `FileExporter`), each with a web implementation and a native one. Two custom Capacitor plugins (`PnoteSecure`, `PnoteCapture`) hold the Kotlin/Swift code. Native code cannot be compiled in this workspace (no Android SDK, no macOS), so it is built and tested by a GitHub Actions workflow on Android and iOS runners; TypeScript is tested here as usual.

**Tech Stack:** Stage 1–2 stack + fflate (streaming zip) + @capacitor/core, cli, android, ios 8.x; @capacitor/filesystem, @capacitor/app, @capacitor/share, @capacitor/privacy-screen; Kotlin (Android Keystore, WebView, PrintDocumentAdapter); Swift (Secure Enclave / Keychain, WKWebView). CI: GitHub Actions (`ubuntu-latest` + Android emulator, `macos-latest` + iOS simulator).

**Spec:** `docs/superpowers/specs/2026-11-15-cross-platform-notes-design.md` (§5, §8.1, §8.4, §8.5, §8.5.1, §8.9 step 3)
**Builds on:** Stage 1 and Stage 2 plans (all their interfaces are available).

## Global Constraints

- Data key per profile is wrapped twice, as in the spec: by the PIN-derived key (Argon2id) **and** by a hardware key that cannot leave the device (Android Keystore, StrongBox when present; iOS Secure Enclave P-256, Keychain `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` when there is no Secure Enclave). A copy of the files from another device cannot be decrypted even by trying every PIN.
- Native unlock: PIN of exactly 6 digits. Attempt limits as in Stage 1 (delay from the 5th failure, lock at the 10th, recovery code).
- App data is excluded from cloud and device backups (Android `allowBackup="false"` + data-extraction rules; iOS `isExcludedFromBackup` on the data directory). Hardware keys are this-device-only.
- App content is hidden in the app switcher and screenshots are blocked on Android (`FLAG_SECURE`); iOS shows a cover view in the switcher.
- When the app goes to the background: flush autosave immediately; on return, apply the wall-clock idle lock (5 minutes).
- Web capture stores, per capture: PDF, full-page PNG screenshot, page archive (Android `.mht`, iOS `.webarchive`), and `capture.json` with requested URL, final URL after redirects, device time + time zone, user agent, and SHA-256 of each file. Captured pages show the URL and capture time in a header/footer of the exported PDF.
- The capture browser is shown to the user (they may log in themselves); the app never reads or stores their cookies or passwords. Its cookies are cleared after each capture.
- Exported files are written to the app's cache directory only for the duration of a share, then deleted.
- No network access from app code other than the page the user asked to capture. The capture WebView is separate from the app WebView; the app WebView keeps CSP `connect-src 'self'`.
- `.pnote` files are always encrypted: Argon2id (same parameters as profiles, stored in the file header) from a backup password of at least 10 characters chosen at export, then chunked AES-GCM; no unencrypted variant. Two kinds: one document (to hand to a colleague) and a whole profile (backup / move to a new device). Spec §8.5.2: document ids are stable; importing an id that already exists offers `นำเข้าเป็นสำเนาใหม่` (default) or `แทนที่ของเดิม`; no automatic merge; audit log and authors travel with the file and the receiver's import is appended to the log.
- Backups stream: neither export nor import holds a whole document or profile in memory (1 MB chunks in, 1 MB chunks out).
- UI language Thai. App id `app.pnote.notes` (configurable in `capacitor.config.ts`).

## Review Focus

1. **App sent to the background right after a stroke and then killed by the OS** (no `pagehide` in a WebView) → the stroke is saved. Test in Task 5.
2. **Hardware key gone** (app reinstalled, phone restored from backup, Keystore wiped) → unlock shows `ไม่พบกุญแจของเครื่องนี้ ใช้รหัสกู้คืนเพื่อเปิดโปรไฟล์` and the recovery code re-wraps the data key with a new device key; nothing crashes. Tests in Tasks 3–4.
3. **Capture of a page that needs login, never finishes loading, or is extremely long** → the user can log in inside the sheet; a 60 s load timeout with a Thai message; screenshots capped at 16,384 px tall (taken in tiles and stitched) so memory stays bounded. Tests in Task 6 (TS side) and the device checklist.
4. **A file shared to PNote while no profile is unlocked** → held until a profile is unlocked, then the user confirms which profile receives it; never imported into a profile the user did not choose. Test in Task 7.
5. **Exported PDF or `.pnote` left in the cache after sharing, or the share sheet dismissed** → the temporary file is deleted in every case (success, cancel, error). Tests in Tasks 8 and 9.
6. **Wrong backup password, a truncated or tampered `.pnote`, or a 2 GB profile backup on a tablet** → wrong password and tampering are told apart (`รหัสผ่านไม่ถูกต้อง` / `ไฟล์สำรองเสียหายหรือถูกแก้ไข`); a failed restore leaves no partial profile or document; memory stays bounded. Tests in Task 9.

---

## File Structure

```
apps/mobile/
  package.json, capacitor.config.ts
  android/   (generated by `cap add android`, then edited: manifest, backup rules, plugin code)
    app/src/main/java/app/pnote/notes/{MainActivity.kt, PnoteSecurePlugin.kt, PnoteCapturePlugin.kt, CaptureActivity.kt, IncomingIntent.kt}
    app/src/main/res/xml/data_extraction_rules.xml
    app/src/test/... (JVM unit tests)   app/src/androidTest/... (instrumented: Keystore, capture)
  ios/App/   (generated by `cap add ios`, then edited: Info.plist, plugin code)
    App/{PnoteSecurePlugin.swift, PnoteCapturePlugin.swift, CaptureViewController.swift, AppDelegate.swift}
    AppTests/{SecureKeyTests.swift, CaptureTests.swift}
packages/storage/src/fs-adapter.ts        FilesystemAdapter over a minimal FS interface
packages/storage/src/importer.ts          + importWebCapture()
packages/pdf/src/export.ts                + web-capture header/footer and capture rows on the certificate
apps/web/src/platform/
  index.ts         detect platform, build the right adapters (web vs native)
  native-key.ts    DeviceKeyProvider over PnoteSecure
  capture.ts       WebCapture interface + native impl + web fallback
  incoming.ts      IncomingFiles queue
  exporter.ts      FileExporter (web download vs native cache+share)
  lifecycle.ts     background/foreground hooks (flush, idle check)
packages/storage/src/backup.ts             .pnote writer/reader (streaming encrypt + zip)
packages/storage/src/backup-io.ts          document / profile export & restore over Library + BlobStore
apps/web/src/components/PinPad.svelte, CaptureDialog.svelte, BackupDialog.svelte, RestoreDialog.svelte
apps/web/src/screens/{CreateProfile,Unlock,Recover,Library,Editor}.svelte  (integration)
.github/workflows/native.yml
docs/device-checklist.md
```

---

### Task 1: Capacitor shell and platform switch

**Files:**
- Create: `apps/mobile/package.json`, `apps/mobile/capacitor.config.ts`, `apps/web/src/platform/index.ts`; generated `apps/mobile/android/`, `apps/mobile/ios/` (`npx cap add android`, `npx cap add ios` — run from `apps/mobile`; `pod install` is skipped on Linux and runs in CI)
- Modify: root `package.json` (`build:mobile`: build web, then `cap sync` from `apps/mobile`)
- Test: `apps/web/test/platform.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type PlatformKind = 'web' | 'android' | 'ios';
  export function platformKind(cap?: { isNativePlatform(): boolean; getPlatform(): string }): PlatformKind; // defaults to window.Capacitor
  export interface PlatformServices { kind: PlatformKind; adapter: StorageAdapter; device: DeviceKeyProvider; capture: WebCapture; incoming: IncomingFiles; exporter: FileExporter; lifecycle: Lifecycle }
  export async function createPlatformServices(kind?: PlatformKind): Promise<PlatformServices>; // web: IndexedDbAdapter + WebNoDeviceKey + web fallbacks
  ```
  `capacitor.config.ts`: `appId: 'app.pnote.notes'`, `appName: 'PNote'`, `webDir: '../web/dist'`, `android.allowMixedContent: false`, `server.androidScheme: 'https'`, `plugins.PrivacyScreen.enable: true`. `main.ts` mounts `App` with `createPlatformServices()`.

- [ ] **Step 1: Write the failing test:** `platformKind` → `'web'` with no Capacitor, `'android'`/`'ios'` from a fake; `createPlatformServices('web')` returns `IndexedDbAdapter` and a device with `available === false`.
- [ ] **Step 2:** Run `npx vitest run --project web test/platform.test.ts` → FAIL.
- [ ] **Step 3:** Implement; scaffold `apps/mobile` and add both platforms; switch `main.ts` to `createPlatformServices()`.
- [ ] **Step 4:** Run `npx vitest run` and `npm run build && npm run e2e` → PASS (web unchanged). `npx cap sync` from `apps/mobile` succeeds.
- [ ] **Step 5: Commit** `feat(mobile): Capacitor shell and platform services`

---

### Task 2: Filesystem storage adapter (native)

**Files:**
- Create: `packages/storage/src/fs-adapter.ts`
- Modify: `packages/storage/test/adapters.test.ts` (run the shared contract suite against it)
- Test: `packages/storage/test/fs-adapter.test.ts`

**Interfaces:**
- Produces:
  ```ts
  /** The subset of @capacitor/filesystem used (Directory.Data), so tests can pass an in-memory fake. */
  export interface MiniFs {
    readFile(o: { path: string }): Promise<{ data: string }>;                       // base64
    writeFile(o: { path: string; data: string; recursive: true }): Promise<void>;
    rename(o: { from: string; to: string }): Promise<void>;
    deleteFile(o: { path: string }): Promise<void>;
    readdir(o: { path: string }): Promise<{ files: { name: string; type: 'file' | 'directory' }[] }>;
    excludeFromBackup?(path: string): Promise<void>;                                  // iOS: isExcludedFromBackup via PnoteSecure
  }
  export class FilesystemAdapter implements StorageAdapter { constructor(fs: MiniFs, root = 'pnote') }
  export function encodeKey(path: string): string; // '/p1/documents/a b' → 'pnote/p1/documents/a%20b' (percent-encode except [A-Za-z0-9._-/])
  ```
  `put` writes `<file>.tmp` then renames over `<file>` (atomic on both platforms). Missing file on `get` → `null`; missing directory on `list` → `[]`. `excludeFromBackup(root)` is called once on first use.

- [ ] **Step 1: Write the failing tests:** contract suite (put/get/delete/list/copy semantics from Stage 1) passes against `FilesystemAdapter` + in-memory `MiniFs`; a crash between tmp write and rename leaves the old value readable (fake `rename` throws once); keys with Thai and spaces round-trip and `list('/p1/')` returns original keys; `excludeFromBackup` called once with `'pnote'`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx vitest run --project storage` → PASS.
- [ ] **Step 5: Commit** `feat(storage): filesystem adapter for native apps`

---

### Task 3: Hardware-bound device keys (PnoteSecure plugin)

**Files:**
- Create: `apps/web/src/platform/native-key.ts`, `apps/mobile/android/app/src/main/java/app/pnote/notes/PnoteSecurePlugin.kt`, `apps/mobile/ios/App/App/PnoteSecurePlugin.swift`, `apps/mobile/android/app/src/androidTest/java/app/pnote/notes/SecureKeyTest.kt`, `apps/mobile/ios/App/AppTests/SecureKeyTests.swift`
- Modify: `packages/storage/src/device-key.ts` (add `DeviceKeyMissing`), `packages/storage/src/profiles.ts` (distinguish a missing/invalid device key from a wrong PIN; re-wrap on recovery)
- Test: `apps/web/test/native-key.test.ts`, `packages/storage/test/profiles.test.ts` (extend)

**Interfaces:**
- Produces:
  ```ts
  // JS ⇄ native contract (both platforms)
  interface PnoteSecure {
    status(): Promise<{ available: boolean; hardware: 'strongbox' | 'tee' | 'secure-enclave' | 'keychain' }>;
    wrap(o: { data: string }): Promise<{ data: string }>;     // base64 in/out
    unwrap(o: { data: string }): Promise<{ data: string }>;   // rejects with code 'KEY_MISSING' | 'KEY_INVALID' | 'DECRYPT_FAILED'
    excludeFromBackup(o: { path: string }): Promise<void>;    // iOS only; Android no-op
  }
  export class NativeDeviceKey implements DeviceKeyProvider { static async create(plugin: PnoteSecure): Promise<NativeDeviceKey> } // available from status()
  // @pnote/storage/device-key gains: export class DeviceKeyMissing extends Error {}  — thrown by DeviceKeyProvider.unwrap for KEY_MISSING / KEY_INVALID (lives in storage so ProfileService can recognise it)
  // UnlockResult gains: { ok: false; reason: 'device-key-missing' }
  // ProfileService.recover(...) re-wraps with the *current* device key (a new one is created natively on first wrap)
  ```
  - Android: alias `pnote-device-key-v1`, `KeyGenParameterSpec` AES/GCM/NoPadding 256, `setIsStrongBoxBacked(true)` with fallback to TEE on `StrongBoxUnavailableException`, `setRandomizedEncryptionRequired(true)`; output `iv(12) || ciphertext+tag`. `KeyPermanentlyInvalidatedException` → `KEY_INVALID`.
  - iOS: Secure Enclave P-256 key, tag `app.pnote.notes.device-key.v1`, `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`, `.privateKeyUsage`; wrap with `SecKeyCreateEncryptedData(.eciesEncryptionCofactorVariableIVX963SHA256AESGCM)`. No Secure Enclave (simulator): a random 256-bit key in a this-device-only Keychain item + AES-GCM (CryptoKit). Missing key → `KEY_MISSING`.

- [ ] **Step 1: Write the failing TS tests:** `NativeDeviceKey` round-trips bytes through a fake plugin (base64 correct for 0, 1 and 4096 bytes); plugin `KEY_MISSING` → `DeviceKeyMissing`; `ProfileService.unlock` with a device whose `unwrap` throws `DeviceKeyMissing` → `{ ok:false, reason:'device-key-missing' }` and **does not count a failed attempt**; `recover` after that succeeds and the next `unlock` with the new PIN works using the fake device's new key.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement TS; write Kotlin and Swift plugins and their native tests (round-trip; distinct ciphertexts for the same input; tampered ciphertext → `DECRYPT_FAILED`; deleting the key → `KEY_MISSING`).
- [ ] **Step 4:** Run `npx vitest run` → PASS. Native tests run in CI (Task 9).
- [ ] **Step 5: Commit** `feat(mobile): hardware-bound device keys`

---

### Task 4: Six-digit PIN on native

**Files:**
- Create: `apps/web/src/components/PinPad.svelte`
- Modify: `apps/web/src/screens/CreateProfile.svelte`, `Unlock.svelte`, `Recover.svelte`, `apps/web/src/App.svelte` (pass `device.available` down)
- Test: `apps/web/test/pin.test.ts`

**Interfaces:**
- Produces: `PinPad` props `{ length: 6; onComplete: (pin: string) => void; disabled?: boolean; label: string }` — digits 0–9 and delete, large touch targets (≥ 56 px), no system keyboard, auto-submits at 6 digits, clears after a wrong attempt. When `device.available`, create asks PIN then `ยืนยัน PIN`; unlock and recover use the pad. Copy: `ใส่ PIN 6 หลัก`, `PIN ไม่ตรงกัน`, `PIN ไม่ถูกต้อง เหลือ {n} ครั้ง`, device-key-missing → `ไม่พบกุญแจของเครื่องนี้ ใช้รหัสกู้คืนเพื่อเปิดโปรไฟล์` with a `ใช้รหัสกู้คืน` button. Web build unchanged (password ≥ 8).

- [ ] **Step 1: Write the failing tests** (@testing-library/svelte, fake device `available: true`): tapping 6 digits calls `onComplete('123456')` once; create with mismatched confirmation shows `PIN ไม่ตรงกัน`; unlock wrong PIN shows the attempts message and clears the pad; device-key-missing shows its message and the recovery button; with `available: false` the password form is shown as before.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat(web): PIN pad for native unlock`

---

### Task 5: Background/foreground lifecycle and privacy screen

**Files:**
- Create: `apps/web/src/platform/lifecycle.ts`
- Modify: `apps/web/src/screens/Editor.svelte` (flush on background), `apps/web/src/App.svelte` (idle check on resume), `apps/mobile/capacitor.config.ts` (PrivacyScreen), Android `MainActivity.kt` (`FLAG_SECURE` via the plugin), `AndroidManifest.xml` (`allowBackup="false"`, `dataExtractionRules`, `fullBackupContent="false"`)
- Test: `apps/web/test/lifecycle.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface Lifecycle { onBackground(cb: () => void): () => void; onForeground(cb: () => void): () => void }
  export function webLifecycle(): Lifecycle;                         // visibilitychange
  export function nativeLifecycle(app: { addListener(e: 'pause' | 'resume', cb: () => void): Promise<{ remove(): void }> }): Lifecycle;
  // EditorSession: flush on lifecycle.onBackground; App: idleLock.check() on onForeground
  ```

- [ ] **Step 1: Write the failing tests:** native lifecycle fake emits `pause` → an open `EditorSession`'s pending stroke is saved (spy `saveDocument`) **without waiting for the 500 ms debounce**; `resume` after 6 minutes of wall-clock time → App locks; `resume` after 1 minute → stays unlocked; listeners removed on dispose.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement; configure privacy screen and backup exclusion.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat(mobile): lifecycle flush, privacy screen, no backups`

---

### Task 6: Web page capture (PnoteCapture plugin) and import as evidence

**Files:**
- Create: `apps/web/src/platform/capture.ts`, `apps/web/src/components/CaptureDialog.svelte`, `apps/mobile/android/.../PnoteCapturePlugin.kt`, `CaptureActivity.kt`, `apps/mobile/ios/App/App/PnoteCapturePlugin.swift`, `CaptureViewController.swift`, native tests `CaptureTest.kt`, `CaptureTests.swift`
- Modify: `packages/storage/src/importer.ts` (`importWebCapture`), `packages/pdf/src/export.ts` (header/footer + certificate rows), `apps/web/src/screens/Library.svelte` (`＋ บันทึกหน้าเว็บ`)
- Test: `packages/pdf/test/importer.test.ts` (extend), `packages/pdf/test/export.test.ts` (extend), `apps/web/test/capture.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface CaptureResult { requestedUrl: string; finalUrl: string; title: string; userAgent: string; capturedAt: number; timeZone: string;
    pdf: Uint8Array; png: Uint8Array; archive: Uint8Array; archiveType: 'mht' | 'webarchive' }
  export interface WebCapture { available: boolean; capture(url: string): Promise<CaptureResult> } // rejects: 'CANCELLED' | 'TIMEOUT' | 'LOAD_FAILED' | 'INVALID_URL'
  export const webCaptureFallback: WebCapture; // available: false — UI shows "พิมพ์ → บันทึกเป็น PDF แล้วนำเข้า"
  // JS ⇄ native: PnoteCapture.capture({ url }) → { requestedUrl, finalUrl, title, userAgent, capturedAt, timeZone, pdfPath, pngPath, archivePath, archiveType }
  //   files are written to the app cache; capture.ts reads them with Filesystem, then deletes them
  export interface CaptureRecord { requestedUrl: string; finalUrl: string; capturedAt: number; timeZone: string; userAgent: string;
    files: { name: 'page.pdf' | 'screenshot.png' | `page.${'mht' | 'webarchive'}`; sha256: string; bytes: number }[] }
  // Importer.importWebCapture(c: CaptureResult, folderId: Id | null): Promise<DocumentMeta>
  //   kind 'web', sourceUrl = finalUrl, capturedAt; source = PDF (pages as in importPdf); blobs `capture/screenshot`, `capture/archive`;
  //   `capture.json` (CaptureRecord, encrypted); audit 'doc.import'; title = page title or host
  // exportPdf: for kind 'web', every page gets a 7 pt grey footer `ที่มา: {finalUrl} · บันทึกเมื่อ {time th-TH} ({timeZone})`;
  //   certificate adds rows: URL ที่ขอ, URL สุดท้าย, SHA-256 ของภาพหน้าจอ, SHA-256 ของไฟล์เก็บหน้าเว็บ
  ```
  Native behaviour: a full-screen sheet with the page, the URL, `ยกเลิก` and `บันทึกหน้านี้`; 60 s load timeout; capture uses a non-persistent data store (iOS `WKWebsiteDataStore.nonPersistent()`; Android: separate WebView, cookies cleared on close). PDF: iOS `WKWebView.createPDF`, Android `PrintDocumentAdapter` → PDF file (A4). Screenshot: full content height capped at 16,384 px, drawn in 2,048 px tiles. Archive: Android `saveWebArchive` (.mht), iOS `createWebArchiveData` (.webarchive).

- [ ] **Step 1: Write the failing TS tests:** `importWebCapture` with fixture PDF/PNG/archive → meta kind `web`, `sourceUrl`, `capturedAt`, `capture.json` decrypts to a record whose three SHA-256s match the inputs, audit `doc.import`; failure mid-import leaves nothing (as in Stage 2); export of a web document has the footer text on every original page and the certificate rows; `capture.ts` deletes the three cache files after reading even when reading the second one fails; `webCaptureFallback.available === false`; dialog shows the fallback instructions on web and maps `TIMEOUT` to `หน้าเว็บโหลดไม่เสร็จภายใน 60 วินาที`, `INVALID_URL` to `ลิงก์ไม่ถูกต้อง`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement TS, then the native plugins and their tests (local HTML fixture served from the test bundle: PDF has ≥ 1 page, PNG height ≤ 16,384, archive non-empty, `finalUrl` after a redirect).
- [ ] **Step 4:** Run `npx vitest run` → PASS. Native tests in CI.
- [ ] **Step 5: Commit** `feat(mobile): save web pages as evidence`

---

### Task 7: Receiving files from other apps

**Files:**
- Create: `apps/web/src/platform/incoming.ts`, `apps/mobile/android/.../IncomingIntent.kt`
- Modify: Android `AndroidManifest.xml` (intent filters `ACTION_SEND` / `ACTION_VIEW` for `application/pdf`, `image/*`), iOS `Info.plist` (`CFBundleDocumentTypes` for `com.adobe.pdf`, `public.image`; `LSSupportsOpeningDocumentsInPlace = NO`), `AppDelegate.swift` (copy the opened URL into the app cache and notify), `apps/web/src/App.svelte` (`IncomingDialog`: `นำเข้า "{name}" ไปที่โปรไฟล์ {profile}?`)
- Test: `apps/web/test/incoming.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface IncomingFile { name: string; mime: string; path: string } // in the app cache
  export class IncomingFiles {
    constructor(source: { onFile(cb: (f: IncomingFile) => void): () => void; read(path: string): Promise<Blob>; remove(path: string): Promise<void> });
    readonly pending: IncomingFile[];
    onChange(cb: () => void): () => void;
    take(f: IncomingFile): Promise<Blob>;   // read, remove from cache, drop from pending
    discard(f: IncomingFile): Promise<void>;
  }
  ```

- [ ] **Step 1: Write the failing tests:** a file arriving while locked stays in `pending` and is not imported; after unlock the App shows the confirmation naming the unlocked profile; confirming calls `Importer.importPdf` for that profile and the cache file is removed; cancelling discards and removes it; two files queue in order.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement TS and native glue.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat(mobile): open PDFs and images from other apps`

---

### Task 8: Native export and share without leftovers

**Files:**
- Create: `apps/web/src/platform/exporter.ts`
- Modify: `apps/web/src/screens/Editor.svelte` (use `FileExporter` instead of the download link)
- Test: `apps/web/test/exporter.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface FileExporter { canShare: boolean; save(name: string, bytes: Uint8Array): Promise<void>; share(name: string, bytes: Uint8Array): Promise<void> }
  export function webExporter(): FileExporter;  // download link / navigator.share (Stage 2 behaviour)
  export function nativeExporter(deps: { writeCache(name: string, bytes: Uint8Array): Promise<string /* uri */>; remove(uri: string): Promise<void>; share(o: { files: string[]; title: string }): Promise<void>; saveToFiles(uri: string): Promise<void> }): FileExporter;
  // native save = system "save to Files / Downloads" dialog; both paths delete the cache file in finally
  ```

- [ ] **Step 1: Write the failing tests:** native `share` writes the cache file, calls share with its uri, and removes it after success, after the user cancels (share rejects `'Share canceled'`), and after an error; `save` likewise; file names sanitised as in Stage 2.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat(mobile): share exports without leaving files behind`

---

### Task 9: Encrypted `.pnote` backups — one document or a whole profile

**Files:**
- Create: `packages/storage/src/backup.ts`, `packages/storage/src/backup-io.ts`, `apps/web/src/components/BackupDialog.svelte`, `apps/web/src/components/RestoreDialog.svelte`
- Modify: `packages/storage/src/crypto.ts` (streaming chunk API), `packages/storage/src/profiles.ts` (`createFromBackup`), `apps/web/src/platform/exporter.ts` (streaming sink), `apps/web/src/screens/Library.svelte` (document menu `ส่งออกเป็น .pnote`; library menu `สำรองโปรไฟล์ทั้งหมด`, `นำเข้าไฟล์ .pnote`), `apps/web/src/screens/ProfilePicker.svelte` (`กู้คืนโปรไฟล์จากไฟล์สำรอง`), `apps/web/src/platform/incoming.ts` (accept `.pnote`), Android manifest / iOS `Info.plist` (register the `.pnote` type, UTI `app.pnote.notes.backup`)
- Test: `packages/storage/test/backup.test.ts`, `packages/storage/test/backup-io.test.ts`, `apps/web/test/backup-ui.test.ts`

**Interfaces:**
- Consumes: `EncryptedStore`, `BlobStore`, `Library`, `ProfileService`, `appendAudit`, `verifyAudit`, `FileExporter`, `IncomingFiles`, `fflate` (streaming `Zip` / `Unzip`, store-only for already-compressed blobs).
- Produces:
  ```ts
  // crypto.ts — streaming form of the Stage 1 chunk format (same AAD layout; chunk count and length are written in a trailer chunk)
  export function createChunkEncryptor(key: CryptoKey, context: Uint8Array): { push(plain: Uint8Array): Promise<Uint8Array[]>; finish(): Promise<Uint8Array[]> };
  export function createChunkDecryptor(key: CryptoKey, context: Uint8Array): { push(cipher: Uint8Array): Promise<Uint8Array[]>; finish(): Promise<void> }; // finish() throws TamperedError if truncated

  // backup.ts — file layout: "PNOTE1\n" · u32 header length · header JSON (plaintext) · encrypted stream of a zip
  export interface BackupHeader { format: 'pnote'; version: 1; kind: 'document' | 'profile'; createdAt: number; kdf: { alg: 'argon2id'; memoryKiB: number; iterations: number; parallelism: number; salt: string }; verifier: string } // verifier = AES-GCM of a fixed string, tells a wrong password from tampering
  export interface BackupSink { write(bytes: Uint8Array): Promise<void>; close(): Promise<void>; abort(): Promise<void> }
  export class BackupWriter { static async create(sink: BackupSink, kind: BackupHeader['kind'], password: string): Promise<BackupWriter>; addFile(path: string, data: Uint8Array | BlobSource, compress: boolean): Promise<void>; close(): Promise<void>; abort(): Promise<void> }
  export class BackupReader {
    static async open(src: BlobSource, password: string): Promise<BackupReader>; // throws BackupWrongPassword | BackupCorrupt | BackupUnsupported
    readonly header: BackupHeader;
    entries(onFile: (path: string, data: AsyncIterable<Uint8Array>) => Promise<void>): Promise<void>; // streams; throws BackupCorrupt on any auth failure
  }
  export class BackupWrongPassword extends Error {} export class BackupCorrupt extends Error {} export class BackupUnsupported extends Error {}
  export const MIN_BACKUP_PASSWORD = 10;

  // backup-io.ts — zip contents (plaintext inside the encrypted stream)
  //   manifest.json { kind, exportedAt, exportedBy, appVersion, documents: [{ id, title, files: [{ path, sha256, bytes }] }], folders?, presets? }
  //   documents/<id>/meta.json, audit.json, pages/*.bin, text/*.json, source/blob (reassembled original), capture/* (web captures)
  export async function exportDocument(lib: Library, blobs: BlobStore, docId: Id, sink: BackupSink, password: string, by: Author, onProgress?: (done: number, total: number) => void): Promise<void>;
  export async function exportProfile(lib: Library, blobs: BlobStore, sink: BackupSink, password: string, by: Author, onProgress?: (done: number, total: number) => void): Promise<void>;
  export type ConflictChoice = 'copy' | 'replace';
  export async function importDocuments(lib: Library, blobs: BlobStore, reader: BackupReader, by: Author, choose: (existing: DocumentMeta, incoming: { id: Id; title: string }) => Promise<ConflictChoice>): Promise<DocumentMeta[]>;
  //   copy: new document id; the audit chain is kept as is and a 'doc.import' entry by the receiver is appended
  //   replace: the existing document is hidden (moved to documents/<id>/replaced-<time>/ — never deleted) and the incoming one takes its id
  //   per document: files are written to a staging id, sha256 checked against manifest.json, verifyAudit run, then meta written last
  // ProfileService.createFromBackup(name, pin, avatarColor): same as create(); the caller then runs importDocuments into the new profile's store
  ```
  - Export: `ส่งออกเป็น .pnote` (one document) and `สำรองโปรไฟล์ทั้งหมด` (all documents, folders, presets). Dialog asks the backup password twice with `รหัสผ่านไฟล์สำรอง (อย่างน้อย 10 ตัวอักษร)` and warns `ถ้าลืมรหัสผ่านนี้ จะเปิดไฟล์สำรองไม่ได้`. File name `<title or profile>_<YYYY-MM-DD>.pnote`. Native: written to the cache through `FileExporter` and offered to Share / Save to Files, then deleted; web: download.
  - Restore on a new device: profile picker → `กู้คืนโปรไฟล์จากไฟล์สำรอง` → choose file → backup password → new PIN (native) or password (web) → new recovery code shown as at creation → documents restored with progress.
  - Import one document into the current profile: from the library menu or when a `.pnote` arrives through `IncomingFiles`; a profile backup opened inside an unlocked profile imports its documents into that profile after confirmation.

- [ ] **Step 1: Write the failing tests:**
  - `backup.test.ts`: write then read a backup with three files (one 2.5 MB) → identical bytes; wrong password → `BackupWrongPassword`; flipping one byte in the encrypted body → `BackupCorrupt`; truncating the file → `BackupCorrupt`; changing the header kind → `BackupCorrupt` (header is bound as AAD context); `version: 2` → `BackupUnsupported`; password of 9 characters → rejected at `create`; **peak buffered bytes in writer and reader stay below 4 MB while streaming a 20 MB file** (instrumented sink/source).
  - `backup-io.test.ts`: export a document (PDF source, strokes, text boxes, OCR layer, audit) and import it into a second profile → same pages, objects, text layer and source SHA-256; audit verifies and ends with a `doc.import` by the receiver; importing the same file again with `copy` → a second document with a new id; with `replace` → one visible document, the old one kept under `replaced-*`; a manifest SHA-256 mismatch for one file → that document is not imported, nothing staged is left, others still import; a profile backup restores folders, presets and every document into a new profile created with `createFromBackup`; the exported file contains no plaintext title (scan bytes).
  - `backup-ui.test.ts`: mismatched passwords and short passwords show errors; native `share` path deletes the cache file on success, cancel and error; a `.pnote` arriving while locked waits like other incoming files.
- [ ] **Step 2:** Run `npx vitest run --project storage --project web` → FAIL.
- [ ] **Step 3:** Implement `crypto.ts` streaming, `backup.ts`, `backup-io.ts`, `createFromBackup`, then the dialogs and menus.
- [ ] **Step 4:** Run `npx vitest run` → PASS; `npm run build && npm run e2e` → PASS (add an e2e: create notebook → export `.pnote` → new browser context → restore profile from it → stroke visible).
- [ ] **Step 5: Commit** `feat: encrypted .pnote document and profile backups`

---

### Task 10: CI builds and native tests, installable Android build, device checklist

**Files:**
- Create: `.github/workflows/native.yml`, `docs/device-checklist.md`

**Interfaces:**
- Produces: workflow jobs
  - `web`: `npm ci`, `npm test`, `npm run build`, `npm run check:no-external`, Playwright e2e with the runner's Chrome.
  - `android` (ubuntu-latest, JDK 21, Android SDK via `android-actions/setup-android`): `npm run build:mobile`, `./gradlew testDebugUnitTest assembleDebug`, instrumented tests on an API 34 emulator (`reactivecircus/android-emulator-runner`), upload `app-debug.apk` as an artifact.
  - `ios` (macos-latest, Xcode 16): `npm run build:mobile`, `pod install`, `xcodebuild test -scheme App -destination 'platform=iOS Simulator,name=iPad (10th generation)'` (unsigned).
  - `docs/device-checklist.md`: numbered manual checks on a real Android tablet and iPad — palm rejection with a stylus, pressure, 300 MB PDF open and scroll, OCR of a Thai scan, capture of a login-only page, app-switcher cover, screenshot blocked (Android), backgrounding then force-quit keeps the last stroke, reinstall → device-key-missing → recovery works, profile backup on device A restored on device B (Android → iPad and back).

- [ ] **Step 1:** Write the workflow; push the branch.
- [ ] **Step 2:** Run it (`gh workflow run native.yml --ref stage3-mobile`, then `gh run watch`) → expect native test failures to surface any defects from Tasks 3, 6 and 9 (`.pnote` type registration); fix each with a failing native test first.
- [ ] **Step 3:** All three jobs green; the APK artifact downloads and installs on an Android device (checked by the user with the checklist).
- [ ] **Step 4: Commit** `ci: build and test Android and iOS`

---

## What only the user can provide (needed before or during Task 10)

- **Apple:** an Apple Developer account (personal or organisation) to install on a real iPad (TestFlight or ad hoc). CI builds and tests on the simulator without one.
- **Android:** nothing to start (the debug APK installs directly). For a signed release: a keystore kept by the user — never committed; the workflow reads it from a repository secret.
- **App id** `app.pnote.notes` is a placeholder; change it in `capacitor.config.ts` if the organisation has a naming rule. It cannot change after publishing to a store.
- **Real devices** for the checklist (an Android tablet with stylus and an iPad with Apple Pencil).

## Decisions this plan makes (for review)

- **iOS archive is `.webarchive`, not MHTML.** WKWebView only produces Apple's web archive; Android produces MHTML. Both are hashed and recorded the same way.
- **Data cannot move between devices by copying files** — by design, because the hardware key never leaves the device. Moving to a new device, or surviving a lost one, uses the password-encrypted `.pnote` profile backup (Task 9, brought forward from Stage 4 at the user's request). The recovery code only helps on the same device. Backups are as safe as their password, so the minimum is 10 characters and the file says nothing in plaintext except that it is a PNote backup.
- **"Replace" never deletes**: the replaced document is kept hidden inside the profile, in line with hide-never-delete.
- **No biometrics** (Face ID / fingerprint) in Stage 3: not in the spec, and the PIN is part of the key protection; it can be added later as a convenience that unlocks the PIN-wrapped key.
- **Capture uses a private, throw-away browser session**, so the user logs in each time a page needs it; the app never keeps their cookies.
- **Native code is verified in CI, not in this workspace**, because this environment has neither the Android SDK nor macOS.
