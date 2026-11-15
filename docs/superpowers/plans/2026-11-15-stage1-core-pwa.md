# Stage 1 — Core + PWA (notebooks, ink, profiles) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working offline PWA where multiple local profiles (password-locked, encrypted at rest) create notebooks and write on them with pen or finger, with fine pen settings, presets, scribble-to-erase, auto shapes, lasso, eraser, undo/redo, autosave and a tamper-evident audit log.

**Architecture:** npm-workspaces monorepo. Pure TypeScript packages (`@pnote/core` model/history/audit, `@pnote/ink` input/geometry/render, `@pnote/storage` crypto/adapters/profiles/library) are platform-free and unit-tested; `apps/web` is a Svelte 5 + Vite PWA that wires them to the DOM. Later stages add `apps/mobile` (Capacitor) and `apps/desktop` (Tauri) around the same build.

**Tech Stack:** Node 22, TypeScript 5 (strict), Vite 6, Svelte 5, Vitest 3 (+ jsdom, fake-indexeddb), @testing-library/svelte, Playwright, perfect-freehand, hash-wasm (Argon2id), vite-plugin-pwa.

**Spec:** `docs/superpowers/specs/2026-11-15-cross-platform-notes-design.md`

## Global Constraints

- No network calls at runtime except the app's own origin; no analytics/telemetry/CDN. CSP: `default-src 'self'; connect-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'`.
- All coordinates in page points (pt). Default page A4 portrait = 595.28 × 841.89 pt.
- Ink latency target: live stroke drawn within one frame (~16 ms) on 2020+ iPad.
- "Deleting" ink/shapes = set `hidden: true`; never remove data. Every mutation appends an audit entry.
- Profile data never readable by another profile; everything under `/<profileId>/` is encrypted.
- Web build: secret is a password of ≥ 8 characters (not a 6-digit PIN). KDF Argon2id. Show banner `เวอร์ชันเว็บ ความปลอดภัยต่ำกว่าแอปติดตั้ง`.
- Wrong secret: failures 1–4 no delay; failure n ≥ 5 delay `30s × 2^(n−5)`; failure 10 → profile locked (recovery code only).
- Recovery code: 24 characters, issued at profile creation.
- Auto-lock after 5 minutes idle (configurable). Clear keys from memory on lock.
- Autosave 500 ms after a stroke ends.
- Pen width 0.2–20 pt; max 10 pen presets per profile.
- Scribble-to-erase: zig-zag with ≥ 3 direction reversals over existing ink; toggle in settings.
- Auto shape: hold still 0.5 s at stroke end → line / arrow / ellipse / rect / triangle; undo returns the hand stroke.
- Pen mode: only `pen` (and `mouse`) draw; touch only pans/zooms. Finger mode: 1 finger draws, 2 fingers pan/zoom.
- Toolbar collapsible to one button, dockable top/bottom/left/right, full-screen reading mode (3-finger tap or button), position remembered per screen size.
- UI language Thai.

## Review Focus

1. **App closed mid-session** (tab closed / iOS kills PWA right after a stroke) → last stroke still there after reopen. Test in Task 14 (`flush on pagehide`).
2. **Reloading to reset the PIN counter** → failed-attempt count and delay persist across reloads. Test in Task 6 (`attempts survive new ProfileService instance`).
3. **Palm touching the screen while drawing with pen / second finger landing mid-stroke in finger mode** → no stray strokes; finger-mode stroke is cancelled, not committed. Tests in Task 9.
4. **Very long strokes (5,000+ points) and pages with 2,000 strokes** → serialize/deserialize round-trips and hit-testing stays < 50 ms. Tests in Tasks 7 and 12.
5. **Same document open in two tabs** → second tab opens read-only with `เอกสารนี้เปิดอยู่ในแท็บอื่น — เปิดแบบอ่านอย่างเดียว`; no silent overwrite. Test in Task 14.

---

## File Structure

```
package.json                     workspaces, scripts: test, build, e2e, check:no-external
tsconfig.base.json
vitest.workspace.ts
packages/core/src/
  types.ts        model types
  ids.ts          newId()
  hash.ts         sha256Hex, canonicalJson
  audit.ts        append-only hash-chained log
  doc-state.ts    immutable DocState + pure reducers
  history.ts      command stack (undo/redo) emitting audit records
  serialize.ts    stroke/page binary encoding
packages/ink/src/
  pressure.ts     pressure curves
  outline.ts      perfect-freehand wrapper
  input-router.ts pointer → actions (pen/finger modes, gestures)
  scribble.ts     scribble detection + targets
  shapes.ts       shape recognition + hold detection
  hit-test.ts     lasso, eraser, bbox
  templates.ts    plain/lined/grid lines
  renderer.ts     canvas renderer (base + live layer)
packages/storage/src/
  crypto.ts       Argon2id KDF, key wrap, chunked AES-GCM, recovery code
  device-key.ts   DeviceKeyProvider interface + WebNoDeviceKey
  adapter.ts      StorageAdapter + MemoryAdapter
  idb-adapter.ts  IndexedDbAdapter
  encrypted-store.ts
  profiles.ts     ProfileService
  library.ts      folders / documents / save-load
apps/web/
  index.html, vite.config.ts, src/main.ts, src/App.svelte
  src/lib/{autosave.ts, doc-lock.ts, idle-lock.ts, toolbar-state.ts, session.ts}
  src/screens/{ProfilePicker,CreateProfile,Unlock,Recover,Library,Editor}.svelte
  src/components/{Toolbar,PenPresetPanel,PageStrip,SecurityBanner}.svelte
  e2e/*.spec.ts
scripts/check-no-external.mjs
```

---

### Task 1: Monorepo scaffold + core types and ids

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `vitest.workspace.ts`, `packages/{core,ink,storage}/package.json`, `packages/core/src/types.ts`, `packages/core/src/ids.ts`
- Test: `packages/core/test/ids.test.ts`

**Interfaces:**
- Produces (`@pnote/core/types`):
  ```ts
  export type Id = string;
  export type InputKind = 'pen' | 'touch' | 'mouse';
  export type Tool = 'pen' | 'highlighter';
  export type PressureCurve = 'soft' | 'normal' | 'firm' | 'off';
  export interface PenStyle { color: string; width: number; opacity: number; pressureCurve: PressureCurve; taperStart: number; taperEnd: number; smoothing: number } // width 0.2–20, opacity/taper/smoothing 0–1
  export interface Author { profileId: Id; name: string }
  export interface Stroke { id: Id; pageId: Id; tool: Tool; style: PenStyle; points: Float32Array /* x,y,p,t repeating */; input: InputKind; author: Author; hidden?: boolean; createdAt: number }
  export type ShapeGeometry =
    | { kind: 'line' | 'arrow'; x1: number; y1: number; x2: number; y2: number }
    | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number }
    | { kind: 'rect'; x: number; y: number; w: number; h: number }
    | { kind: 'triangle'; pts: [number, number, number, number, number, number] };
  export interface Shape { id: Id; pageId: Id; geometry: ShapeGeometry; style: PenStyle; sourceStrokeId: Id; author: Author; hidden?: boolean; createdAt: number }
  export type PageTemplate = 'plain' | 'lined' | 'grid';
  export type PageSource = { type: 'blank'; template: PageTemplate } | { type: 'pdf'; pageNo: number } | { type: 'image'; blobId: Id };
  export interface PageRef { id: Id; source: PageSource; widthPt: number; heightPt: number }
  export type DocKind = 'notebook' | 'pdf' | 'image' | 'web';
  export interface DocumentMeta { id: Id; profileId: Id; folderId: Id | null; title: string; kind: DocKind; sourceBlobId?: Id; sourceSha256?: string; sourceUrl?: string; capturedAt?: number; pages: PageRef[]; createdAt: number; updatedAt: number }
  export interface Folder { id: Id; profileId: Id; parentId: Id | null; name: string }
  export interface PenPreset { id: Id; name: string; tool: Tool; style: PenStyle }
  export const A4: { widthPt: 595.28; heightPt: 841.89 };
  ```
- Produces: `newId(): Id` (wraps `crypto.randomUUID()`).

- [ ] **Step 1:** Create root `package.json` with `"workspaces": ["packages/*", "apps/*"]`, scripts `test` (`vitest run`), `build` (`npm run build -w apps/web`), `e2e` (`playwright test -c apps/web`), `check:no-external` (`node scripts/check-no-external.mjs`); strict `tsconfig.base.json`; `vitest.workspace.ts` listing the three packages (environment `node`) and `apps/web` (environment `jsdom`). Install dev deps.
- [ ] **Step 2: Write the failing test** `ids.test.ts`: `newId()` matches `/^[0-9a-f-]{36}$/`; 1,000 calls yield 1,000 distinct values; `A4` equals `{widthPt: 595.28, heightPt: 841.89}`.
- [ ] **Step 3:** Run `npx vitest run packages/core` → FAIL (module not found).
- [ ] **Step 4:** Implement `types.ts` and `ids.ts`.
- [ ] **Step 5:** Run `npx vitest run packages/core` → PASS. `npx tsc -p packages/core --noEmit` → no errors.
- [ ] **Step 6: Commit** `git commit -m "chore: scaffold monorepo and core types"`

---

### Task 2: Hashing and hash-chained audit log

**Files:**
- Create: `packages/core/src/hash.ts`, `packages/core/src/audit.ts`
- Test: `packages/core/test/audit.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function canonicalJson(v: unknown): string;               // sorted keys, no whitespace
  export async function sha256Hex(data: Uint8Array | string): Promise<string>; // WebCrypto
  export type AuditAction = 'doc.create' | 'stroke.add' | 'stroke.hide' | 'stroke.unhide' | 'objects.move' | 'shape.add' | 'shape.hide' | 'shape.unhide' | 'page.add' | 'page.remove' | 'page.reorder' | 'preset.save';
  export interface AuditEntry { seq: number; time: number; profileId: Id; profileName: string; action: AuditAction; objectIds: Id[]; prevHash: string; hash: string }
  export const GENESIS_HASH: string; // '0'.repeat(64)
  export async function appendAudit(log: readonly AuditEntry[], e: { time: number; author: Author; action: AuditAction; objectIds: Id[] }): Promise<AuditEntry[]>; // returns new array
  export async function verifyAudit(log: readonly AuditEntry[]): Promise<{ ok: true } | { ok: false; brokenAt: number }>;
  ```
  `hash = sha256Hex(canonicalJson({seq, time, profileId, profileName, action, objectIds, prevHash}))`; `seq` starts at 1.

- [ ] **Step 1: Write the failing tests:** `canonicalJson({b:1,a:{d:2,c:3}}) === '{"a":{"c":3,"d":2},"b":1}'`; `sha256Hex('abc') === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'`; appending 3 entries gives seq 1,2,3 with `log[0].prevHash === GENESIS_HASH` and `log[i].prevHash === log[i-1].hash`; `verifyAudit` ok; mutating `log[1].objectIds` → `{ok:false, brokenAt:1}`; deleting `log[1]` → `{ok:false, brokenAt:1}`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat(core): hash-chained audit log`

---

### Task 3: DocState reducers and undo/redo history

**Files:**
- Create: `packages/core/src/doc-state.ts`, `packages/core/src/history.ts`
- Test: `packages/core/test/history.test.ts`

**Interfaces:**
- Consumes: types (Task 1), `AuditAction` (Task 2).
- Produces:
  ```ts
  export interface DocState { pages: PageRef[]; strokes: Record<Id, Stroke[]>; shapes: Record<Id, Shape[]> } // keyed by pageId
  export type Command =
    | { type: 'addStroke'; stroke: Stroke }
    | { type: 'hideObjects'; pageId: Id; ids: Id[] }          // strokes or shapes
    | { type: 'moveObjects'; pageId: Id; ids: Id[]; dx: number; dy: number }
    | { type: 'addShape'; shape: Shape }                       // also hides shape.sourceStrokeId
    | { type: 'addPage'; page: PageRef; atIndex: number }
    | { type: 'removePage'; pageId: Id }                        // page kept in removed list for undo; audit only
    | { type: 'reorderPage'; pageId: Id; toIndex: number };
  export function applyCommand(s: DocState, c: Command): DocState;   // pure
  export function invertCommand(before: DocState, c: Command): Command | Command[]; // e.g. addStroke → hideObjects; hideObjects → unhide
  export interface AuditRecord { action: AuditAction; objectIds: Id[] }
  export class History {
    constructor(initial: DocState);
    readonly state: DocState;
    apply(c: Command): AuditRecord[];   // clears redo stack
    undo(): AuditRecord[] | null;       // null when nothing to undo
    redo(): AuditRecord[] | null;
    readonly canUndo: boolean; readonly canRedo: boolean;
    onChange(cb: (s: DocState) => void): () => void;
  }
  ```
  Add internal command `{ type: 'unhideObjects'; pageId; ids }` (exported in the `Command` union). Undo of `addStroke` hides the stroke (audit `stroke.hide`), never removes it. Undo of `addShape` hides the shape and unhides the source stroke.

- [ ] **Step 1: Write the failing tests:** add stroke → visible; undo → `hidden:true`, still in array, records `[{action:'stroke.hide',...}]`; redo → visible again (`stroke.unhide`); addShape hides its source stroke, undo restores it; moveObjects shifts every x by dx and y by dy in `points` and shape geometry; addPage/reorderPage/removePage change `pages` order and undo restores it; `apply` after `undo` empties redo (`canRedo === false`); `applyCommand` does not mutate its input (freeze input with `structuredClone` + compare).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat(core): doc state and undo/redo history`

---

### Task 4: Crypto primitives

**Files:**
- Create: `packages/storage/src/crypto.ts`, `packages/storage/src/device-key.ts`
- Test: `packages/storage/test/crypto.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const KDF_PARAMS: { memoryKiB: 65536; iterations: 3; parallelism: 1; hashLength: 32 }; // Argon2id via hash-wasm
  export function randomBytes(n: number): Uint8Array;
  export async function deriveKek(secret: string, salt: Uint8Array): Promise<CryptoKey>;          // AES-KW 256
  export async function generateDataKey(): Promise<CryptoKey>;                                     // AES-GCM 256, extractable
  export async function wrapDataKey(dataKey: CryptoKey, kek: CryptoKey): Promise<Uint8Array>;
  export async function unwrapDataKey(wrapped: Uint8Array, kek: CryptoKey): Promise<CryptoKey>;    // throws WrongKeyError
  export const CHUNK_SIZE = 1_048_576;
  export async function encryptBytes(key: CryptoKey, plain: Uint8Array): Promise<Uint8Array>;
  export async function decryptBytes(key: CryptoKey, data: Uint8Array): Promise<Uint8Array>;      // throws TamperedError
  export async function decryptChunk(key: CryptoKey, data: Uint8Array, index: number): Promise<Uint8Array>;
  export function generateRecoveryCode(): string;  // 24 Crockford-base32 chars shown as XXXX-XXXX-XXXX-XXXX-XXXX-XXXX
  export function normalizeRecoveryCode(input: string): string; // uppercase, strip dashes/spaces, map O→0 I/L→1
  export class WrongKeyError extends Error {}  export class TamperedError extends Error {}
  // device-key.ts
  export interface DeviceKeyProvider { readonly available: boolean; wrap(b: Uint8Array): Promise<Uint8Array>; unwrap(b: Uint8Array): Promise<Uint8Array> }
  export const WebNoDeviceKey: DeviceKeyProvider; // available:false; wrap/unwrap are identity
  ```
  Encrypted format: `"PNC1"` (4 B) · chunkSize u32 LE · chunkCount u32 LE · plainLength u64 LE · per chunk `[iv 12 B][ciphertext+tag]`; AES-GCM AAD = chunk index as u32 LE (prevents chunk reordering).

- [ ] **Step 1: Write the failing tests:** round-trip empty, 10 B, and `CHUNK_SIZE*2+5` B buffers; `decryptChunk(…, 2)` returns the last 5 bytes; flipping one ciphertext byte → `TamperedError`; swapping chunk 0 and 1 → `TamperedError`; wrong kek on unwrap → `WrongKeyError`; same secret+salt derives a kek that unwraps; recovery code matches `/^([0-9A-HJKMNP-TV-Z]{4}-){5}[0-9A-HJKMNP-TV-Z]{4}$/`; `normalizeRecoveryCode('abcd-efgh ijkl-mnop-qrst-vwxy') === 'ABCDEFGH1JK1MN0PQRSTVWXY'`. (Tests may override `KDF_PARAMS.memoryKiB` to 1024 via an exported `__setKdfParamsForTest` to stay fast.)
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat(storage): crypto primitives`

---

### Task 5: Storage adapters and EncryptedStore

**Files:**
- Create: `packages/storage/src/adapter.ts`, `packages/storage/src/idb-adapter.ts`, `packages/storage/src/encrypted-store.ts`
- Test: `packages/storage/test/adapters.test.ts`, `packages/storage/test/encrypted-store.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface StorageAdapter { get(path: string): Promise<Uint8Array | null>; put(path: string, data: Uint8Array): Promise<void>; delete(path: string): Promise<void>; list(prefix: string): Promise<string[]> }
  export class MemoryAdapter implements StorageAdapter {}
  export class IndexedDbAdapter implements StorageAdapter { constructor(dbName = 'pnote') }  // one object store "files", key = path
  export class EncryptedStore {
    constructor(adapter: StorageAdapter, key: CryptoKey, profileId: Id);   // every path prefixed `/${profileId}/`
    getJSON<T>(rel: string): Promise<T | null>; putJSON(rel: string, v: unknown): Promise<void>;
    getBytes(rel: string): Promise<Uint8Array | null>; putBytes(rel: string, b: Uint8Array): Promise<void>;
    delete(rel: string): Promise<void>; list(relPrefix: string): Promise<string[]>; // returns rel paths
  }
  ```

- [ ] **Step 1: Write the failing tests:** shared adapter contract suite run against `MemoryAdapter` and `IndexedDbAdapter` (with `fake-indexeddb/auto`): put/get/delete, get missing → null, `list('/a/')` returns only keys under `/a/` sorted. EncryptedStore: JSON round-trip; raw bytes stored in adapter do **not** contain the plaintext string `"secret-title"`; store for profile A cannot read profile B's paths (list scoped; get on B's key with A's store → null because of prefix).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat(storage): adapters and encrypted store`

---

### Task 6: ProfileService (create, unlock, attempt limits, recovery)

**Files:**
- Create: `packages/storage/src/profiles.ts`
- Test: `packages/storage/test/profiles.test.ts`

**Interfaces:**
- Consumes: Tasks 4–5.
- Produces:
  ```ts
  export interface ProfileSummary { id: Id; name: string; avatarColor: string; locked: boolean; createdAt: number }
  export type UnlockResult =
    | { ok: true; profile: ProfileSummary; store: EncryptedStore; key: CryptoKey }
    | { ok: false; reason: 'wrong'; attemptsLeft: number }
    | { ok: false; reason: 'delayed'; retryAfterMs: number }
    | { ok: false; reason: 'locked' };
  export class WeakSecretError extends Error {}
  export const MIN_WEB_SECRET_LENGTH = 8;
  export class ProfileService {
    constructor(adapter: StorageAdapter, device: DeviceKeyProvider, now?: () => number);
    list(): Promise<ProfileSummary[]>;
    create(name: string, secret: string, avatarColor: string): Promise<{ profile: ProfileSummary; recoveryCode: string }>;
    unlock(id: Id, secret: string): Promise<UnlockResult>;
    recover(id: Id, recoveryCode: string, newSecret: string): Promise<UnlockResult>; // resets attempts & locked; recovery code stays the same
    rename(id: Id, name: string): Promise<void>;
  }
  ```
  Record at `/_profiles/<id>.json` (plaintext metadata only): `{id,name,avatarColor,createdAt,salt,wrappedBySecret,recoverySalt,wrappedByRecovery,failedAttempts,nextAllowedAt,locked}` (bytes as base64). When `device.available`, `wrappedBySecret = device.wrap(wrapDataKey(dataKey, kek))`. Web (`!device.available`) rejects secrets shorter than 8 with `WeakSecretError`. Delay rule from Global Constraints; `attemptsLeft = 10 − failedAttempts`.

- [ ] **Step 1: Write the failing tests** (inject `now` clock): create → list shows it, recoveryCode valid format; unlock with right secret → ok and the returned store round-trips JSON; secret `'1234567'` → `WeakSecretError`; 4 wrong → each `{reason:'wrong'}` with attemptsLeft 9..6; 5th wrong → `wrong`, then immediate retry → `{reason:'delayed', retryAfterMs:30000}`; after advancing clock 30 s, 6th wrong → next delay 60000; 10th wrong → `locked`, and correct secret afterwards still → `locked`; **attempts survive new ProfileService instance** on the same adapter; `recover` with code typed lowercase with spaces → ok, unlocks with new secret, old secret → wrong; data written before recovery is still readable after it.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat(storage): profile service with attempt limits and recovery`

---

### Task 7: Stroke serialization and Library (folders, documents, save/load)

**Files:**
- Create: `packages/core/src/serialize.ts`, `packages/storage/src/library.ts`
- Test: `packages/core/test/serialize.test.ts`, `packages/storage/test/library.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3, 5.
- Produces:
  ```ts
  // serialize.ts
  export function encodePage(strokes: Stroke[], shapes: Shape[]): Uint8Array;   // JSON header + concatenated Float32 point buffers
  export function decodePage(b: Uint8Array): { strokes: Stroke[]; shapes: Shape[] };
  // library.ts
  export class Library {
    constructor(store: EncryptedStore, author: Author, now?: () => number);
    listFolders(): Promise<Folder[]>; createFolder(name: string, parentId: Id | null): Promise<Folder>;
    renameFolder(id: Id, name: string): Promise<void>; deleteFolder(id: Id): Promise<void>; // throws FolderNotEmptyError
    listDocuments(folderId: Id | null): Promise<DocumentMeta[]>;
    searchByTitle(q: string): Promise<DocumentMeta[]>;   // case-insensitive, Thai-safe substring (NFC normalize)
    createNotebook(title: string, folderId: Id | null, template?: PageTemplate, pageCount?: number): Promise<DocumentMeta>; // default 'plain', 1 page, A4
    openDocument(id: Id): Promise<{ meta: DocumentMeta; state: DocState; audit: AuditEntry[] }>;
    saveDocument(meta: DocumentMeta, state: DocState, audit: AuditEntry[], dirtyPageIds: Id[]): Promise<void>; // writes only dirty pages
    renameDocument(id: Id, title: string): Promise<void>; moveDocument(id: Id, folderId: Id | null): Promise<void>;
    listPresets(): Promise<PenPreset[]>; savePresets(p: PenPreset[]): Promise<void>; // throws TooManyPresetsError when > 10
  }
  ```
  Layout: `folders.json`, `index.json` (DocumentMeta[] without pages), `documents/<docId>/meta.json`, `documents/<docId>/pages/<pageId>.bin`, `documents/<docId>/audit.json`, `presets.json`. `createNotebook` appends a `doc.create` audit entry.

- [ ] **Step 1: Write the failing tests:** encode/decode round-trip preserves every field and exact Float32 values incl. `hidden`; **a 5,000-point stroke and a page of 2,000 strokes round-trip** and decode in < 50 ms; Library: create folder + notebook, list, search `'คดี'` finds `'สำนวนคดี 2569'`, save then re-open returns equal state and audit; save with `dirtyPageIds=[p2]` writes only `p2.bin` (spy on adapter.put); deleteFolder non-empty throws; 11 presets → `TooManyPresetsError`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat: page serialization and library`

---

### Task 8: Pressure curves, stroke outline, page templates

**Files:**
- Create: `packages/ink/src/pressure.ts`, `packages/ink/src/outline.ts`, `packages/ink/src/templates.ts`
- Test: `packages/ink/test/outline.test.ts`, `packages/ink/test/templates.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function applyPressureCurve(p: number, curve: PressureCurve): number; // soft p^0.6, normal p, firm p^1.6, off 0.5; clamps to [0,1]
  export function strokeOutline(points: Float32Array, style: PenStyle, input: InputKind): [number, number][];
  // perfect-freehand getStroke: size=style.width, thinning = curve==='off'?0:0.6, smoothing=style.smoothing, streamline=0.5,
  // start.taper = style.taperStart*style.width*8, end.taper = style.taperEnd*style.width*8, simulatePressure = input !== 'pen'
  export const DEFAULT_PEN: PenStyle;          // builder's choice of values within constraints
  export const DEFAULT_HIGHLIGHTER: PenStyle;  // opacity ≤ 0.4
  export function clampStyle(s: PenStyle): PenStyle; // width into [0.2,20], others into [0,1]
  export interface TemplateLine { x1: number; y1: number; x2: number; y2: number }
  export function templateLines(t: PageTemplate, widthPt: number, heightPt: number): TemplateLine[];
  // lined: horizontal every 24 pt starting at y=72; grid: both directions every 14.17 pt (5 mm); plain: []
  ```

- [ ] **Step 1: Write the failing tests:** curve values at p=0.25 for each curve (`soft≈0.4353`, `normal 0.25`, `firm≈0.1088`, `off 0.5`); `clampStyle({width:30})` → 20 and `0.05` → 0.2; outline of a straight 2-point stroke is a non-empty closed polygon whose bbox height ≈ style.width (±20%); `off` curve outline width is constant along the stroke (max/min half-width ratio < 1.1); templates: lined A4 first y=72, spacing 24, all lines within page; grid line count = `floor(595.28/14.17)+floor(841.89/14.17)` (±2 for edges); plain → `[]`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat(ink): pressure, outline, templates`

---

### Task 9: Input router (pen/finger modes, gestures, palm rejection)

**Files:**
- Create: `packages/ink/src/input-router.ts`
- Test: `packages/ink/test/input-router.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type InputMode = 'pen' | 'finger';
  export interface PointerSample { type: 'down' | 'move' | 'up' | 'cancel'; pointerId: number; pointerType: InputKind; x: number; y: number; pressure: number; t: number }
  export type RouterAction =
    | { kind: 'stroke-begin'; pointerId: number; input: InputKind; x: number; y: number; p: number; t: number }
    | { kind: 'stroke-point'; pointerId: number; x: number; y: number; p: number; t: number }
    | { kind: 'stroke-end'; pointerId: number }
    | { kind: 'stroke-cancel'; pointerId: number }
    | { kind: 'pan'; dx: number; dy: number }
    | { kind: 'zoom'; scale: number; cx: number; cy: number }   // scale = factor relative to previous event
    | { kind: 'three-finger-tap' };
  export class InputRouter { constructor(mode: InputMode); setMode(m: InputMode): void; handle(s: PointerSample): RouterAction[] }
  ```
  Rules: pen mode — `pen`/`mouse` draw, `touch` never draws (1 touch = pan, 2 = pinch zoom); finger mode — first touch draws; a second touch arriving while a touch stroke is active → `stroke-cancel` for it and switch to gesture; pen always draws in both modes. Three touches down and all up within 300 ms with < 10 px movement → `three-finger-tap`. Only one active stroke at a time; extra pens ignored.

- [ ] **Step 1: Write the failing tests:** pen mode: pen down/move/up → begin/point/end; touch down/move during an active pen stroke → only `pan` actions and the pen stroke continues (palm rejection); two touches moving apart → `zoom` with scale > 1. Finger mode: touch draws; **second finger landing mid-stroke → `stroke-cancel` then gesture actions, no `stroke-end`**; pen in finger mode still draws. Three-finger quick tap → one `three-finger-tap`; slow (400 ms) → none. `cancel` sample → `stroke-cancel`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat(ink): input router`

---

### Task 10: Hit testing — eraser, lasso, bbox

**Files:**
- Create: `packages/ink/src/hit-test.ts`
- Test: `packages/ink/test/hit-test.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface BBox { minX: number; minY: number; maxX: number; maxY: number }
  export function strokeBBox(s: Stroke): BBox; export function shapeBBox(s: Shape): BBox;
  export function strokesNearPoint(x: number, y: number, radiusPt: number, strokes: Stroke[]): Id[];   // visible only; distance to polyline segments ≤ radius + width/2
  export function objectsInLasso(lasso: [number, number][], strokes: Stroke[], shapes: Shape[]): Id[]; // ≥ 50% of a stroke's points inside polygon; shapes by bbox center
  export function shapesNearPoint(x: number, y: number, radiusPt: number, shapes: Shape[]): Id[];
  ```
  Use a bbox pre-filter before segment distance.

- [ ] **Step 1: Write the failing tests:** point on a stroke → its id; 10 pt away with radius 5 → none; hidden strokes never returned; lasso around 2 of 3 strokes → exactly those 2; stroke half in/half out (60% inside) → included, 40% → excluded; **2,000 strokes × 200 points: `strokesNearPoint` < 50 ms**.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat(ink): hit testing`

---

### Task 11: Scribble-to-erase detection

**Files:**
- Create: `packages/ink/src/scribble.ts`
- Test: `packages/ink/test/scribble.test.ts`

**Interfaces:**
- Consumes: `strokeBBox`, segment distance helpers (Task 10).
- Produces:
  ```ts
  export const SCRIBBLE_MIN_REVERSALS = 3;
  export function isScribble(points: Float32Array): boolean;
  export function scribbleTargets(points: Float32Array, strokes: Stroke[], shapes: Shape[]): Id[];
  ```
  `isScribble`: project onto the stroke's principal axis (PCA); count direction reversals where each leg ≥ 4 pt; true when reversals ≥ 3 **and** path length ÷ bbox diagonal ≥ 2.5. `scribbleTargets`: visible objects whose bbox intersects the scribble bbox and that the scribble polyline crosses (segment intersection or within width/2), returning [] when none.

- [ ] **Step 1: Write the failing tests:** synthetic zig-zag with 4 reversals, 40 pt wide → true; a handwritten-like "w" (2 reversals) → false; a straight line → false; a tight zig-zag of 4 legs each 2 pt long → false; scribble crossing stroke A but not B → `[A]`; scribble over empty area → `[]`; scribble over a rect shape → its id.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat(ink): scribble to erase`

---

### Task 12: Shape recognition and hold detection

**Files:**
- Create: `packages/ink/src/shapes.ts`
- Test: `packages/ink/test/shapes.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const HOLD_MS = 500; export const HOLD_TOLERANCE_PT = 2;
  export function isHolding(points: Float32Array, nowT: number): boolean; // last samples spanning ≥ HOLD_MS all within HOLD_TOLERANCE_PT of the final point (and nowT − lastT counted as still holding)
  export function recognizeShape(points: Float32Array): ShapeGeometry | null;
  ```
  Algorithm: closed if end-to-start distance < 15% of path length. Open: `line` if max deviation from chord < 6% of chord length; `arrow` if Ramer–Douglas–Peucker (ε = 4% of length) gives 4 vertices where the first segment ≥ 3× each of the last two and those two form a "V" at the shaft end with each 20–70° from the shaft. Closed: RDP (ε = 5% of perimeter) → 3 corners → `triangle`; 4 corners with interior angles 70–110° → `rect` (axis-aligned bbox of the corners); else `ellipse` if std(radius)/mean(radius) < 0.2 around the centroid; otherwise null. Geometry output is fitted (ellipse = bbox center/half-sizes).

- [ ] **Step 1: Write the failing tests:** noisy line (±1 pt jitter) → `line` with endpoints within 3 pt; arrow drawn shaft + head → `arrow`; noisy circle r=50 → `ellipse` with rx, ry ≈ 50 ±5; rough square → `rect`; triangle → `triangle`; random scribble → null; handwritten letter "S" → null. `isHolding`: points stationary for 520 ms → true; 480 ms → false; drift of 5 pt → false.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat(ink): shape recognition`

---

### Task 13: Canvas renderer

**Files:**
- Create: `packages/ink/src/renderer.ts`
- Test: `packages/ink/test/renderer.test.ts` (jsdom + `vitest-canvas-mock`)

**Interfaces:**
- Consumes: Tasks 8, 1.
- Produces:
  ```ts
  export interface Viewport { scale: number; offsetX: number; offsetY: number; dpr: number } // screen = (pt*scale + offset)*dpr
  export class PageRenderer {
    constructor(base: HTMLCanvasElement, live: HTMLCanvasElement);
    setViewport(v: Viewport): void;
    renderPage(page: PageRef, strokes: Stroke[], shapes: Shape[]): void; // template, then highlighters (multiply), then pens and shapes; skips hidden; caches outlines by stroke id
    drawLive(points: Float32Array, tool: Tool, style: PenStyle, input: InputKind): void; // clears and draws only the live layer
    clearLive(): void;
    invalidate(strokeIds?: Id[]): void;
  }
  export function ptToScreen(v: Viewport, x: number, y: number): [number, number];
  export function screenToPt(v: Viewport, sx: number, sy: number): [number, number];
  ```

- [ ] **Step 1: Write the failing tests:** `screenToPt(ptToScreen(p)) ≈ p` for several viewports; `renderPage` draws highlighters before pens (inspect mocked `ctx.__getEvents()` order, `globalCompositeOperation === 'multiply'` during highlighter fill); hidden strokes produce no fill call; second `renderPage` with unchanged strokes does not call `strokeOutline` again (spy) and `invalidate([id])` forces recompute for that id only; `drawLive` touches only the live canvas context.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat(ink): canvas renderer`

---

### Task 14: Web session plumbing — autosave, doc lock, idle lock, toolbar state

**Files:**
- Create: `apps/web/package.json`, `apps/web/vite.config.ts`, `apps/web/index.html`, `apps/web/src/lib/autosave.ts`, `apps/web/src/lib/doc-lock.ts`, `apps/web/src/lib/idle-lock.ts`, `apps/web/src/lib/toolbar-state.ts`, `apps/web/src/lib/session.ts`
- Test: `apps/web/test/lib.test.ts`

**Interfaces:**
- Consumes: `ProfileService`, `Library`, `History`, `appendAudit`.
- Produces:
  ```ts
  export function createAutosave(save: () => Promise<void>, delayMs = 500): { schedule(): void; flush(): Promise<void>; dispose(): void }; // also flushes on 'pagehide' and visibilitychange→hidden
  export async function acquireDocLock(docId: Id): Promise<{ readOnly: false; release(): void } | { readOnly: true }>; // navigator.locks 'pnote-doc-<id>' ifAvailable
  export const READ_ONLY_MESSAGE = 'เอกสารนี้เปิดอยู่ในแท็บอื่น — เปิดแบบอ่านอย่างเดียว';
  export function createIdleLock(timeoutMs: number, onLock: () => void): { reset(): void; dispose(): void }; // listens to pointerdown/keydown on window
  export const DEFAULT_IDLE_MS = 300_000;
  export type Dock = 'top' | 'bottom' | 'left' | 'right';
  export interface ToolbarState { collapsed: boolean; dock: Dock; fullscreen: boolean }
  export function sizeBucket(widthPx: number): 's' | 'm' | 'l';  // <768 s, <1200 m, else l
  export function loadToolbarState(widthPx: number): ToolbarState; export function saveToolbarState(widthPx: number, s: ToolbarState): void; // localStorage key `pnote.toolbar.<bucket>`, default {collapsed:false,dock:'top',fullscreen:false}
  export class EditorSession { // glue used by Editor.svelte
    static open(lib: Library, author: Author, docId: Id): Promise<EditorSession>;
    readonly meta: DocumentMeta; readonly history: History; readonly readOnly: boolean;
    run(c: Command): Promise<void>;   // history.apply + appendAudit + mark dirty + autosave.schedule; no-op when readOnly
    undo(): Promise<void>; redo(): Promise<void>;
    close(): Promise<void>;          // flush + release lock
  }
  ```

- [ ] **Step 1: Write the failing tests** (fake timers): autosave calls `save` once 500 ms after three `schedule()` calls in 100 ms; **`dispatchEvent(new Event('pagehide'))` flushes immediately**; idle lock fires after 300,000 ms and `reset()` postpones it; toolbar state round-trips per bucket and different buckets are independent; `acquireDocLock` with a stub `navigator.locks` that reports unavailable → `{readOnly:true}`; EditorSession with MemoryAdapter: `run(addStroke)` then advance 500 ms → reopening the doc shows the stroke and the audit chain verifies; **readOnly session `run` does not write**.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat(web): session plumbing`

---

### Task 15: Profile screens

**Files:**
- Create: `apps/web/src/main.ts`, `apps/web/src/App.svelte`, `apps/web/src/screens/{ProfilePicker,CreateProfile,Unlock,Recover}.svelte`, `apps/web/src/components/SecurityBanner.svelte`
- Test: `apps/web/test/profile-screens.test.ts` (@testing-library/svelte)

**Interfaces:**
- Consumes: `ProfileService`, `IndexedDbAdapter`, `WebNoDeviceKey`, `createIdleLock`.
- Produces: `App.svelte` routes `picker → create | unlock → library`; on lock returns to `unlock` and drops `store`/`key` references.

Exact copy (Thai):
- Create warning: `ถ้าลืมรหัสผ่านและรหัสกู้คืน จะไม่สามารถเปิดข้อมูลในโปรไฟล์นี้ได้อีก`
- Recovery confirm checkbox: `ฉันจดรหัสกู้คืนเก็บไว้แล้ว` (Continue button disabled until checked)
- Web banner: `เวอร์ชันเว็บ ความปลอดภัยต่ำกว่าแอปติดตั้ง`
- Delay: `ใส่รหัสผิดหลายครั้ง ลองใหม่ได้ใน {n} วินาที`; locked: `โปรไฟล์ถูกล็อก ใช้รหัสกู้คืนเพื่อปลดล็อก`

- [ ] **Step 1: Write the failing tests:** create flow shows recovery code and Continue stays disabled until the checkbox is ticked; password of 7 chars shows an error and does not create; wrong password shows attempts left; delayed result shows the countdown text; locked result shows the locked message and a link to Recover; banner visible on every screen.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat(web): profile screens`

---

### Task 16: Library and Editor screens with toolbar and presets

**Files:**
- Create: `apps/web/src/screens/{Library,Editor}.svelte`, `apps/web/src/components/{Toolbar,PenPresetPanel,PageStrip}.svelte`, `apps/web/src/lib/editor-controller.ts`
- Test: `apps/web/test/editor-controller.test.ts`, `apps/web/e2e/editor.spec.ts`

**Interfaces:**
- Consumes: everything above.
- Produces:
  ```ts
  export type ActiveTool = 'pen' | 'highlighter' | 'eraser' | 'lasso';
  export class EditorController { // pure-ish logic, DOM-free
    constructor(session: EditorSession, opts: { scribbleToErase: boolean; autoShapes: boolean });
    mode: InputMode; tool: ActiveTool; style: PenStyle;
    onActions(pageId: Id, actions: RouterAction[], nowT: number): Promise<void>;
    // stroke-end with tool pen: if scribbleToErase && isScribble → run hideObjects(scribbleTargets) (no stroke added when targets non-empty)
    // else if autoShapes && hold detected during stroke → run addStroke then addShape(recognizeShape) when not null
    // eraser: hide strokesNearPoint/shapesNearPoint (radius 6 pt) along the drag, one command per drag
    // lasso: on end select objectsInLasso; dragging the selection → moveObjects; Delete → hideObjects
    applyPreset(p: PenPreset): void; addPage(template: PageTemplate): Promise<void>;
  }
  ```
  Toolbar: mode switch (นิ้ว / ปากกา), tools, colour, width slider 0.2–20 step 0.1, opacity, pressure curve (นุ่ม/ปกติ/แข็ง/ปิด), taper start/end, smoothing, presets (save current, max 10), undo/redo, collapse `⌃`, dock picker, full-screen. Library: folder tree, notebook grid with thumbnails (render first page at small scale), new notebook dialog (title, template), rename, move, search by title.

- [ ] **Step 1: Write the failing tests** (controller with MemoryAdapter-backed session): pen stroke adds 1 visible stroke; zig-zag over it with scribble on → the stroke is hidden and no new stroke exists; same with scribble off → 2 strokes; circle stroke ending with 520 ms hold and autoShapes on → source stroke hidden + one `ellipse` shape, and `undo` restores the hand stroke; eraser drag across 2 strokes → both hidden in one undo step; lasso + drag 10,10 → points moved by 10 pt; applying a preset changes `style` to the preset's style.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement controller, then the Svelte components (pointer listeners call `getCoalescedEvents()`/`getPredictedEvents()`, `touch-action:none` on the canvas wrapper, render loop via `requestAnimationFrame`).
- [ ] **Step 4:** Run unit tests → PASS.
- [ ] **Step 5: Write the e2e test** `editor.spec.ts` (Playwright, Chromium): create profile → new lined notebook → draw a stroke with mouse → reload → unlock → stroke still rendered (canvas pixel not blank at stroke location); collapse toolbar → only one toolbar button visible; reload → still collapsed.
- [ ] **Step 6:** Run `npm run e2e` → PASS.
- [ ] **Step 7: Commit** `feat(web): library and editor`

---

### Task 17: PWA, offline, and no-external-network guard

**Files:**
- Modify: `apps/web/vite.config.ts` (vite-plugin-pwa: precache all build assets, no runtime caching of other origins, manifest `name: "PNote"`, `lang: "th"`, icons), `apps/web/index.html` (CSP meta from Global Constraints)
- Create: `scripts/check-no-external.mjs`, `apps/web/e2e/offline.spec.ts`
- Modify: `apps/web/src/main.ts` (call `navigator.storage.persist()` once after first unlock; if it resolves false show `เบราว์เซอร์อาจลบข้อมูลถ้าไม่ได้ใช้นาน โปรดติดตั้งแอปหรือสำรองข้อมูลเป็นประจำ`)

**Interfaces:**
- Produces: `node scripts/check-no-external.mjs` exits 1 and prints offending file:line if any built file in `apps/web/dist` contains `http://` or `https://` URLs other than an allowlist (`http://www.w3.org/` namespaces, license comments).

- [ ] **Step 1: Write the failing e2e test** `offline.spec.ts`: load app, create profile + notebook, `context.setOffline(true)`, reload → app loads and the notebook opens; record all requests during the session → every request URL origin equals the app origin.
- [ ] **Step 2:** Run `npm run build && npm run e2e` → FAIL (no service worker).
- [ ] **Step 3:** Implement PWA config, CSP, persist prompt, and the check script.
- [ ] **Step 4:** Run `npm run build && npm run check:no-external && npm run e2e` → all PASS.
- [ ] **Step 5:** Run full suite `npm test` → PASS.
- [ ] **Step 6: Commit** `feat(web): offline PWA and network guard`

---

## Later stage plans (written after Stage 1 ships)

- Stage 2: PDF import/render (OPFS blobs, chunked lazy decrypt), text boxes, Tesseract OCR + search, PDF export with certification page, evidence fields.
- Stage 3: Capacitor Android/iOS — device-key providers (Keystore/Keychain), web-page capture plugins (PDF + PNG + MHTML + capture.json), 6-digit PIN on native.
- Stage 4: Voice notes, `.pnote` encrypted export/import (single doc + profile backup).
- Stage 5: Tauri Windows/macOS — DPAPI/Keychain, WebView2/WKWebView capture.
