# Stage 2 — PDF & images, text boxes, OCR search, PDF export with certification page

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import PDFs and images (up to ~500 pages / 300 MB) without modifying the originals, write and type on them, make scanned pages searchable with on-device Thai+English OCR, and export a vector PDF with a certification page.

**Architecture:** Builds on Stage 1 (`@pnote/core`, `@pnote/ink`, `@pnote/storage`, `apps/web`). Originals are stored as 1 MB encrypted chunks so pdf.js can read byte ranges lazily; a new `@pnote/pdf` package wraps pdf.js (render, text), pdf-lib (export) and Tesseract (OCR, in a Web Worker). Text boxes join strokes and shapes in the page model. Search reads per-page text layers (pdf text or OCR) and text boxes.

**Tech Stack:** Stage 1 stack + pdfjs-dist 6, pdf-lib 1.17 + @pdf-lib/fontkit, tesseract.js 7 with @tesseract.js-data/tha and /eng (bundled, offline), @fontsource/sarabun, hash-wasm (streaming SHA-256).

**Spec:** `docs/superpowers/specs/2026-11-15-cross-platform-notes-design.md` (goals 2, 6, 7, 10; §8.5, §8.5.1, §8.7, §8.8.1, §8.9 step 2)
**Builds on:** `docs/superpowers/plans/2026-11-15-stage1-core-pwa.md` (all interfaces from it are available)

## Global Constraints

- The original file is never modified. Its SHA-256 is computed at import (streaming, never holding the whole file), stored as `sourceSha256`, and re-checked on export.
- Target: 500 pages / 300 MB. Render only the visible page ±2; thumbnails lazily; decrypt source chunks on demand.
- Everything offline: pdf.js worker, Tesseract worker/core/WASM, `tha` + `eng` traineddata and the Sarabun font are bundled assets served from the app origin. CSP stays `connect-src 'self'`.
- OCR: Tesseract (WASM) `tha+eng`, on device, background, one page at a time. PDFs that already have a text layer use pdf.js text (no OCR). Handwriting is never OCRed.
- Text boxes: tool "T"; Thai font Sarabun embedded; size, colour, bold; exported as real (copyable, searchable) text.
- Export: vector strokes (not rasterised); highlighters with opacity and multiply; optional searchable OCR text layer; certification page appended: document title, source (original file name), import time, source SHA-256 (and whether it still matches), authors, number of edits, last audit hash, export time, audit-chain check result, and the note that times come from the device clock.
- Evidence fields on import: SHA-256, original file name, import time; audit action `doc.import`.
- All new mutations are audited; "deleting" a text box hides it.
- UI language Thai.

## Review Focus

1. **Password-protected, corrupt or non-PDF file chosen** → clear Thai error, nothing half-stored in the library. Tests in Task 3.
2. **300 MB PDF on an iPad** → import never reads the whole file into memory (only `File.slice` chunks) and opening reads only the chunks pdf.js asks for. Tests in Tasks 2–3.
3. **Rotated pages and pages whose CropBox does not start at 0,0** → ink lines up on screen and lands in the same place in the exported PDF. Tests in Tasks 4 and 9.
4. **App closed in the middle of an import or OCR run** → no half document in the library (meta written last, orphan chunks removed on next start); OCR resumes from the next unprocessed page. Tests in Tasks 3 and 7.
5. **Thai search against OCR output** (spaces inserted between Thai characters, sara am written as nikhahit + sara aa, zero-width characters, Thai digits) → still matches what the user typed. Tests in Task 8.

---

## File Structure

```
packages/core/src/
  types.ts           + TextBox, PdfPageBox, DocumentMeta.originalName/importedAt
  doc-state.ts       + textBoxes, addTextBox / editTextBox commands
  audit.ts           + 'doc.import' | 'text.add' | 'text.edit' | 'text.hide' | 'text.unhide'
  serialize.ts       + textBoxes in page files (older files decode with [])
packages/storage/src/
  blob-store.ts      chunked encrypted blobs, streaming SHA-256, range reads
  importer.ts        importPdf / importImage
  library.ts         + text layers, thumbnails, orphan cleanup
packages/pdf/src/    (new package @pnote/pdf)
  pdf-source.ts      pdf.js document over BlobStore ranges, page render, page text
  page-box.ts        page-space ↔ PDF user-space transforms (rotation, crop box)
  export.ts          pdf-lib export + certification page
  fonts.ts           Sarabun bytes for pdf-lib
  ocr.ts             OcrEngine interface + Tesseract engine (worker)
  ocr-queue.ts       background OCR runner (resumable)
  search.ts          Thai-aware normalisation + search over text layers
packages/ink/src/
  renderer.ts        + background image, text boxes
  hit-test.ts        + text boxes in lasso / eraser / scribble
apps/web/src/
  lib/editor-controller.ts  + 'text' tool
  components/TextBoxEditor.svelte, PageNavigator.svelte, ExportDialog.svelte, ImportButton.svelte, SearchResults.svelte
  screens/Editor.svelte, Library.svelte   (integration)
  vite.config.ts     + static asset copy for pdf.js / tesseract / fonts, precache size limit
apps/web/e2e/pdf.spec.ts
packages/pdf/test/fixtures/make-fixtures.ts   (pdf-lib generated PDFs: plain, rotated, cropped, encrypted-like, broken)
```

---

### Task 1: Text boxes and import fields in the model

**Files:**
- Modify: `packages/core/src/types.ts`, `doc-state.ts`, `audit.ts`, `serialize.ts`
- Test: `packages/core/test/textbox.test.ts`, `packages/core/test/serialize.test.ts` (extend)

**Interfaces:**
- Produces:
  ```ts
  export interface TextBox { id: Id; pageId: Id; x: number; y: number; w: number; h: number; text: string; font: 'sarabun'; sizePt: number; color: string; bold: boolean; author: Author; hidden?: boolean; createdAt: number; updatedAt: number }
  export interface PdfPageBox { x: number; y: number; w: number; h: number; rotate: 0 | 90 | 180 | 270 } // crop box in PDF user space + /Rotate
  // PageRef gains: pdfBox?: PdfPageBox   (set for source.type === 'pdf')
  // DocumentMeta gains: originalName?: string; importedAt?: number
  // DocState gains: textBoxes: Record<Id, TextBox[]>
  // Command union gains:
  //   { type: 'addTextBox'; box: TextBox }
  //   { type: 'editTextBox'; pageId: Id; id: Id; patch: Partial<Pick<TextBox, 'text' | 'x' | 'y' | 'w' | 'h' | 'sizePt' | 'color' | 'bold'>>; updatedAt: number }
  // hideObjects / unhideObjects / moveObjects also act on text boxes.
  // AuditAction gains: 'doc.import' | 'text.add' | 'text.edit' | 'text.hide' | 'text.unhide'
  export function encodePage(strokes: Stroke[], shapes: Shape[], textBoxes?: TextBox[]): Uint8Array;
  export function decodePage(b: Uint8Array): { strokes: Stroke[]; shapes: Shape[]; textBoxes: TextBox[] };
  ```
  Audit for `editTextBox` records `text.edit` with the box id. `invertCommand(editTextBox)` restores the previous values of exactly the patched fields.

- [ ] **Step 1: Write the failing tests:** add a text box → in `state.textBoxes[pageId]`, audit `text.add`; edit text then undo → previous text and `updatedAt` back, redo → new text; hide/unhide via `hideObjects` records `text.hide`/`text.unhide`; `moveObjects` shifts x/y; `applyCommand` does not mutate input; a Stage 1 page file (encoded without text boxes) decodes with `textBoxes: []`; round-trip with Thai text `'ผู้ต้องหา ๒ คน'` preserves it exactly.
- [ ] **Step 2:** Run `npx vitest run --project core` → FAIL.
- [ ] **Step 3:** Implement. Update `History` audit and `Library.openDocument/saveDocument` to carry `textBoxes`.
- [ ] **Step 4:** Run `npx vitest run` → all PASS (Stage 1 tests included).
- [ ] **Step 5: Commit** `feat(core): text boxes and import fields`

---

### Task 2: Chunked encrypted blob store with streaming SHA-256

**Files:**
- Create: `packages/storage/src/blob-store.ts`
- Test: `packages/storage/test/blob-store.test.ts`

**Interfaces:**
- Consumes: `EncryptedStore` (path-bound AES-GCM).
- Produces:
  ```ts
  export const BLOB_CHUNK = 1_048_576;
  export interface BlobManifest { size: number; chunks: number; sha256: string; mime: string }
  export interface BlobSource { size: number; slice(start: number, end: number): Promise<Uint8Array> } // File adapter: fileSource(file)
  export function fileSource(f: Blob): BlobSource;          // uses f.slice(a,b).arrayBuffer() only
  export class BlobStore {
    constructor(store: EncryptedStore);
    put(rel: string, src: BlobSource, mime: string, onProgress?: (done: number, total: number) => void): Promise<BlobManifest>; // writes `${rel}/NNNNNN` chunks then `${rel}/manifest.json` last
    manifest(rel: string): Promise<BlobManifest | null>;
    readRange(rel: string, start: number, end: number): Promise<Uint8Array>; // decrypts only covering chunks; LRU of 8 decrypted chunks
    readAll(rel: string): Promise<Uint8Array>;
    verify(rel: string): Promise<boolean>;                    // recompute SHA-256 streaming, compare to manifest
    delete(rel: string): Promise<void>;
  }
  ```
  SHA-256 is incremental via `hash-wasm` `createSHA256()`.

- [ ] **Step 1: Write the failing tests:** put a 2.5 MB source → 3 chunk files + manifest with the correct SHA-256 (compare to `sha256Hex` of the whole buffer); `readRange(rel, 1_048_000, 1_049_000)` equals the same slice and decrypts only chunks 0–1 (spy on `EncryptedStore.getBytes`); `readAll` round-trips; `verify` true, then false after overwriting one chunk with another chunk's ciphertext; **`fileSource` never calls `arrayBuffer()` on the whole Blob** (spy: every `slice` length ≤ `BLOB_CHUNK`); `manifest` of an interrupted put (manifest missing) → `null`; `delete` removes all chunk files.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat(storage): chunked blob store`

---

### Task 3: Importer for PDFs and images (+ orphan cleanup)

**Files:**
- Create: `packages/pdf/package.json`, `packages/pdf/src/pdf-source.ts` (open + page geometry only in this task), `packages/pdf/test/fixtures/make-fixtures.ts`, `packages/storage/src/importer.ts`
- Modify: `packages/storage/src/library.ts` (add `cleanupOrphans()`), `vitest.workspace.ts` (add `pdf` project, environment `node`, uses `pdfjs-dist/legacy/build/pdf.mjs`)
- Test: `packages/storage/test/importer.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // @pnote/pdf/pdf-source
  export interface PdfPageInfo { pageNo: number; widthPt: number; heightPt: number; box: PdfPageBox } // width/height as displayed (after /Rotate)
  export class PdfOpenError extends Error { reason: 'password' | 'invalid' }
  export async function readPdfInfo(src: BlobSource): Promise<PdfPageInfo[]>; // pdf.js with range transport; throws PdfOpenError
  // @pnote/storage/importer
  export type ImportError = 'not-pdf' | 'password' | 'corrupt' | 'unsupported-image' | 'too-large';
  export class ImportFailed extends Error { code: ImportError }
  export const MAX_IMPORT_BYTES = 1_073_741_824; // 1 GiB hard stop
  export class Importer {
    constructor(lib: Library, blobs: BlobStore, author: Author, deps: { readPdfInfo: typeof readPdfInfo; imageSize: (src: BlobSource, mime: string) => Promise<{ w: number; h: number }>; now?: () => number });
    importPdf(file: { name: string; size: number; type: string } & Blob, folderId: Id | null, onProgress?: (p: number) => void): Promise<DocumentMeta>;
    importImage(file: { name: string; size: number; type: string } & Blob, folderId: Id | null): Promise<DocumentMeta>;
  }
  // Library: cleanupOrphans(): Promise<number>  — deletes document folders that have no meta.json (interrupted imports); returns count
  ```
  Order: validate header (`%PDF-` within first 1 KB, else `not-pdf`) → `readPdfInfo` (password → `password`, other failure → `corrupt`) → `BlobStore.put('documents/<id>/source', …)` → audit `doc.import` → meta written **last**. Image page: width A4 (595.28 pt), height by aspect ratio; JPG/PNG/WebP accepted, HEIC accepted only when `imageSize` can decode it (Safari), else `unsupported-image`. Title defaults to the file name without extension.

- [ ] **Step 1: Write the fixture builder** (`make-fixtures.ts`, pdf-lib): `plainPdf(pages=3)`, `rotatedPdf()` (page /Rotate 90), `croppedPdf()` (CropBox [50 60 400 500]), `notPdf()` (PNG bytes), `brokenPdf()` (truncated plain), `encryptedPdf()` (static minimal encrypted PDF bytes checked into `fixtures/encrypted.pdf`, generated once with qpdf and committed).
- [ ] **Step 2: Write the failing tests:** plain 3-page → meta kind `pdf`, 3 pages with `source {type:'pdf', pageNo:1..3}`, `originalName`, `importedAt`, `sourceSha256` equal to SHA-256 of the bytes, audit `['doc.import']`; rotated → page width/height swapped and `box.rotate === 90`; cropped → `widthPt 350, heightPt 440`, `box {x:50,y:60}`; `notPdf` → `ImportFailed('not-pdf')`; `brokenPdf` → `corrupt`; encrypted → `password`; **after each failure `lib.listDocuments(null)` is empty and `store.list('documents/')` is empty**; simulate a crash by making `Library.putMeta` throw → `cleanupOrphans()` returns 1 and leaves no files; image 1000×500 px → one page 595.28 × 297.64 pt; HEIC with failing decoder → `unsupported-image`.
- [ ] **Step 3:** Run `npx vitest run --project storage --project pdf` → FAIL.
- [ ] **Step 4:** Implement.
- [ ] **Step 5:** Run → PASS.
- [ ] **Step 6: Commit** `feat: import PDFs and images`

---

### Task 4: Page-space ↔ PDF-space transforms

**Files:**
- Create: `packages/pdf/src/page-box.ts`
- Test: `packages/pdf/test/page-box.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // page space: origin top-left of the displayed page, y down, points (what ink uses)
  // pdf space: PDF user space, origin bottom-left of the MediaBox, y up
  export function pageToPdf(box: PdfPageBox, x: number, y: number): [number, number];
  export function pdfToPage(box: PdfPageBox, x: number, y: number): [number, number];
  export function pageToPdfMatrix(box: PdfPageBox): [number, number, number, number, number, number]; // for pdf-lib concatTransformationMatrix
  ```

- [ ] **Step 1: Write the failing tests:** for each rotate 0/90/180/270 and box `{x:50,y:60,w:350,h:440}`: page top-left `(0,0)` maps to the displayed top-left corner of the crop box in pdf space (0°: `(50, 500)`; 90°: `(50, 60)`; 180°: `(400, 60)`; 270°: `(400, 500)`); `pdfToPage(pageToPdf(p)) ≈ p` for random points; matrix applied to a point equals `pageToPdf`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat(pdf): page box transforms`

---

### Task 5: Rendering PDF and image pages under the ink

**Files:**
- Modify: `packages/pdf/src/pdf-source.ts` (add `PdfDocumentSource`), `packages/ink/src/renderer.ts` (background + text boxes), `apps/web/vite.config.ts` (copy `pdf.worker.min.mjs`, cmaps, standard fonts into `dist/pdfjs/`)
- Test: `packages/pdf/test/pdf-source.test.ts`, `packages/ink/test/renderer.test.ts` (extend)

**Interfaces:**
- Produces:
  ```ts
  export class PdfDocumentSource {
    static open(read: (start: number, end: number) => Promise<Uint8Array>, size: number, opts?: { workerSrc?: string; cMapUrl?: string; standardFontDataUrl?: string }): Promise<PdfDocumentSource>;
    readonly pageCount: number;
    render(pageNo: number, pixelWidth: number): Promise<ImageBitmap | HTMLCanvasElement>; // LRU of 5 renders keyed (pageNo, pixelWidth bucket of 256 px)
    pageWords(pageNo: number): Promise<{ text: string; bbox: [number, number, number, number] }[]>; // bbox in page space (pt)
    prefetch(pageNos: number[], pixelWidth: number): void;
    destroy(): Promise<void>;
  }
  // PageRenderer.renderPage(page, strokes, shapes, textBoxes?: TextBox[], background?: CanvasImageSource | null)
  // draw order: white page → background (scaled to page) → template (blank pages only) → highlighters → pens → shapes → text boxes
  // text boxes: ctx.font = `${bold?'700 ':''}${sizePt}px Sarabun`; wrap by measureText within w; line height 1.4 × size
  ```
  pdf.js options: `isEvalSupported: false`, `disableAutoFetch: true`, `disableStream: true`, `rangeChunkSize: 1_048_576`, worker and cmaps from the app origin (`./pdfjs/…`).

- [ ] **Step 1: Write the failing tests:** `PdfDocumentSource.open` on the 3-page fixture via a spy `read` → `pageCount 3`, and opening plus `pageWords(2)` on a 3-page doc does not read the whole file when it is > 2 MB (generate a fixture padded with a 3 MB embedded stream on page 3; assert total bytes read < size); `pageWords` of a page with `drawText('EVIDENCE 2569')` contains that text with bbox inside the page; rotated fixture words come back in page space (x within displayed width). Renderer: background drawn before strokes (event order), text box produces `fillText` calls with the Sarabun font string, hidden text boxes skipped, long text wraps to more than one `fillText` line.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat(pdf): render pages and read page text`

---

### Task 6: Editor integration — backgrounds, page navigator, text tool

**Files:**
- Create: `apps/web/src/components/PageNavigator.svelte`, `apps/web/src/components/TextBoxEditor.svelte`, `apps/web/src/lib/page-sources.ts`
- Modify: `apps/web/src/lib/editor-controller.ts`, `apps/web/src/screens/Editor.svelte`, `packages/ink/src/hit-test.ts`, `packages/ink/src/scribble.ts`, `apps/web/src/app.css` (import `@fontsource/sarabun/400.css`, `700.css`)
- Test: `apps/web/test/editor-controller.test.ts` (extend), `packages/ink/test/hit-test.test.ts` (extend), `apps/web/test/page-sources.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 2, 5.
- Produces:
  ```ts
  // page-sources.ts — one per open document
  export class PageSources {
    constructor(meta: DocumentMeta, blobs: BlobStore, open?: typeof PdfDocumentSource.open);
    background(page: PageRef, pixelWidth: number): Promise<CanvasImageSource | null>; // pdf render or decoded image; null for blank
    prefetchAround(index: number, pixelWidth: number): void;                           // index ±2
    destroy(): Promise<void>;
  }
  // EditorController
  //   ActiveTool gains 'text'
  //   onActions: with tool 'text', a tap (stroke-end with < 4 pt movement) on empty space emits a pending box via onTextRequest({ pageId, x, y, existing?: TextBox })
  //   tap on an existing visible text box → onTextRequest with existing
  //   commitText(pageId: Id, existing: TextBox | undefined, value: { text: string; sizePt: number; color: string; bold: boolean; x: number; y: number; w: number }): Promise<void>
  //     new + empty text → nothing; existing + empty text → hideObjects; else addTextBox / editTextBox
  //   onTextRequest: ((req: { pageId: Id; x: number; y: number; existing?: TextBox }) => void) | null
  // hit-test: objectsInLasso / textBoxesNearPoint / scribbleTargets include text boxes (bbox)
  export function textBoxesAt(x: number, y: number, boxes: TextBox[]): Id[];
  ```
  Default text box: width 200 pt, size 16 pt, colour = current pen colour. Page navigator: previous/next buttons, page number input (`ไปหน้า`), virtualised thumbnail column (renders only items in view); replaces `PageStrip` when the document has more than 20 pages. Zoom re-renders the background 200 ms after the last zoom event.

- [ ] **Step 1: Write the failing tests:** controller: text tool tap on empty → `onTextRequest` with pt coordinates; `commitText` new → one text box audited `text.add`; tap on it → request with `existing`; commit with new text → `text.edit`; commit empty → hidden; lasso around a text box selects it and drag moves it; scribble over a text box hides it; eraser does **not** hide text boxes (eraser is for ink). `PageSources`: blank page → `null`; pdf page → calls `render(pageNo, width)`; `prefetchAround(10)` requests pages 9–13 (by `pageNo`) and nothing else. `textBoxesAt` hits inside bbox only.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement controller, hit-test and `PageSources`, then wire `Editor.svelte` (background passed to `renderPage`, `TextBoxEditor` overlay positioned with the viewport transform, `PageNavigator`).
- [ ] **Step 4:** Run `npx vitest run` → PASS; `npx svelte-check` 0 errors.
- [ ] **Step 5: Commit** `feat(web): PDF pages, page navigator, text boxes`

---

### Task 7: OCR engine and resumable background queue

**Files:**
- Create: `packages/pdf/src/ocr.ts`, `packages/pdf/src/ocr-queue.ts`
- Modify: `packages/storage/src/library.ts` (text layer read/write), `apps/web/vite.config.ts` (copy tesseract worker, core WASM and `tha`/`eng` traineddata into `dist/tesseract/`; workbox `maximumFileSizeToCacheInBytes: 30_000_000`), `apps/web/src/screens/Editor.svelte` (progress chip `กำลังอ่านข้อความ 12/80`)
- Test: `packages/pdf/test/ocr-queue.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface OcrWord { text: string; bbox: [number, number, number, number]; conf: number } // page space (pt)
  export interface OcrPage { pageId: Id; engine: 'tesseract' | 'pdf-text'; lang: 'tha+eng'; words: OcrWord[]; doneAt: number }
  export interface OcrEngine { recognize(image: ImageBitmap | HTMLCanvasElement, pageWidthPt: number): Promise<OcrWord[]>; terminate(): Promise<void> }
  export function createTesseractEngine(opts: { workerPath: string; corePath: string; langPath: string }): Promise<OcrEngine>; // lang 'tha+eng', OEM LSTM, PSM 3
  export const MIN_PDF_TEXT_CHARS = 20; // a pdf page with at least this much text uses pdf-text
  export class OcrQueue {
    constructor(deps: { lib: Library; docId: Id; pages: PageRef[]; render: (page: PageRef, pixelWidth: number) => Promise<CanvasImageSource | null>; pdfWords: (pageNo: number) => Promise<OcrWord[]>; engine: () => Promise<OcrEngine>; now?: () => number }); // the web app passes PageSources.background as render
    start(): void;                       // processes pages in order that have no stored OcrPage; idle-friendly (one page, then yield)
    stop(): Promise<void>;
    onProgress(cb: (done: number, total: number) => void): () => void;
  }
  // Library: getTextLayer(docId, pageId): Promise<OcrPage | null>; putTextLayer(docId, layer: OcrPage): Promise<void>  (encrypted, `documents/<id>/text/<pageId>.json`)
  ```
  Pages rendered for OCR at 2× point width (≈ 144 dpi equivalent), max 3000 px. Blank notebook pages are skipped. Image documents are OCRed like scanned pages.

- [ ] **Step 1: Write the failing tests** (fake engine + fake source): pdf page with ≥ 20 chars of pdf text → stored with engine `pdf-text`, engine never called; scanned page (no pdf text) → engine called, stored `tesseract`; blank page skipped; progress reports `1/2, 2/2`; **stopping after page 1 and starting a new queue processes only page 2**; engine throwing on one page → page left unprocessed, queue continues, error surfaced via progress; stored layers are encrypted (adapter bytes do not contain the word).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement queue and storage; implement `createTesseractEngine` (not unit-tested; covered by the e2e in Task 10).
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat(pdf): on-device OCR queue`

---

### Task 8: Thai-aware search (library and in-document)

**Files:**
- Create: `packages/pdf/src/search.ts`, `apps/web/src/components/SearchResults.svelte`
- Modify: `apps/web/src/screens/Library.svelte` (results grouped by document with page hits), `apps/web/src/screens/Editor.svelte` (Ctrl/⌘+F or 🔍: find in document, highlight rectangles on the live layer, next/previous)
- Test: `packages/pdf/test/search.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function normalizeForSearch(s: string): string;
  // NFC; lowercase; remove U+200B–U+200D, U+FEFF; Thai digits ๐–๙ → 0–9; 'ํา' (U+0E4D U+0E32) → 'ำ' (U+0E33);
  // remove whitespace between two Thai characters (U+0E00–U+0E7F); collapse other whitespace to one space; trim
  export interface SearchHit { docId: Id; pageId: Id; pageIndex: number; rects: [number, number, number, number][]; snippet: string }
  export function searchPage(layer: OcrPage | null, textBoxes: TextBox[], query: string): { rects: [number, number, number, number][]; snippet: string } | null;
  export async function searchLibrary(lib: Library, query: string, opts?: { limit?: number; signal?: AbortSignal }): Promise<{ titleMatches: DocumentMeta[]; hits: SearchHit[] }>;
  ```
  Matching runs on the concatenation of a page's words (normalised, with an index map back to words) so a query spanning several OCR words still matches; rects are the bboxes of the matched words. Limit default 200 hits; stops early when aborted.

- [ ] **Step 1: Write the failing tests:** `normalizeForSearch('ผู้ ต้อง หา')` equals `normalizeForSearch('ผู้ต้องหา')`; `'นํ้า'` (nikhahit+sara aa) matches `'น้ำ'`; `'คดี​ที่'` matches `'คดีที่'`; `'๒๕๖๙'` matches `'2569'`; English stays word-spaced (`'evidence  2569'` → `'evidence 2569'`); `searchPage` finds a query split across three OCR words and returns three rects; text box text is searchable; `searchLibrary` returns title matches and page hits from two documents, respects `limit`, stops when the signal aborts.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement, then wire the UI.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat: Thai-aware search over OCR and text boxes`

---

### Task 9: PDF export with certification page

**Files:**
- Create: `packages/pdf/src/export.ts`, `packages/pdf/src/fonts.ts`
- Test: `packages/pdf/test/export.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4, 7; `strokeOutline`, `shapePolyline`, `templateLines`, `verifyAudit`.
- Produces:
  ```ts
  export interface ExportInput {
    meta: DocumentMeta; state: DocState; audit: AuditEntry[];
    source: Uint8Array | null;                 // original PDF bytes (pdf docs) — read via BlobStore.readAll
    images: Record<Id, { bytes: Uint8Array; mime: string }>; // image pages
    textLayers: Record<Id, OcrPage>;           // only when includeTextLayer
    sourceIntact: boolean | null;              // BlobStore.verify result; null for notebooks
    exportedAt: number; exportedBy: Author;
  }
  export interface ExportOptions { includeTextLayer: boolean; includeCertificate: true }
  export async function exportPdf(input: ExportInput, opts: ExportOptions): Promise<Uint8Array>;
  export function sarabunBytes(weight: 400 | 700): Promise<Uint8Array>; // fonts.ts: TTF bytes bundled as assets (converted from @fontsource woff2 at build if needed)
  export function certificateLines(input: ExportInput): { label: string; value: string }[]; // pure, for tests and the page
  ```
  - PDF documents: load the original with pdf-lib, keep every original page object (no re-render), draw on top. Notebook/image pages: new pages of the stored size; notebook templates drawn as thin lines (#c9d6e8); images embedded at page size.
  - Strokes: `strokeOutline` polygon → `drawSvgPath` (or raw path operators) filled with colour and opacity, transformed with `pageToPdfMatrix`. Highlighters: opacity + `BlendMode.Multiply`, drawn before pens. Shapes: stroked polylines (arrows with heads). Text boxes: `drawText` with embedded Sarabun subset (bold → 700), same wrapping as the renderer. Hidden objects are not exported.
  - Text layer (optional): each OCR word as invisible text (text rendering mode 3) sized to its bbox width.
  - Certificate page (A4, Sarabun), title `ข้อมูลรับรองเอกสาร`, rows: ชื่อเอกสาร; แหล่งที่มา (original file name, or `สมุดบันทึก`); เวลานำเข้า; SHA-256 ต้นฉบับ (+ `ตรงกับต้นฉบับ` / `ไม่ตรง — ต้นฉบับอาจถูกแก้ไข`); ผู้เขียน (distinct authors from visible objects and audit); จำนวนการแก้ไข (audit length); hash ล่าสุดของประวัติ; ผลตรวจประวัติการแก้ไข (`ต่อเนื่อง` / `ไม่ต่อเนื่อง`); เวลาส่งออก; ผู้ส่งออก; footnote `เวลาทั้งหมดอ้างอิงนาฬิกาของเครื่อง`. Times formatted `th-TH` Buddhist calendar with timezone.

- [ ] **Step 1: Write the failing tests** (parse output back with pdf-lib and pdf.js legacy): exported 3-page PDF has 4 pages and the first 3 page objects keep the original MediaBox; page 1 content stream contains path operators (`re`/`m`/`l`/`c` + `f`) — not an image XObject — for a stroke; hidden stroke not present (content stream length equals the no-stroke export); text box text is extractable by pdf.js `getTextContent` (`'ผู้ต้องหา ๒ คน'`); certificate text contains the SHA-256, `ตรงกับต้นฉบับ`, author names and `ต่อเนื่อง`; `sourceIntact: false` → `ไม่ตรง`; broken audit → `ไม่ต่อเนื่อง`; **rotated and cropped fixtures: a stroke drawn at page-space (10,10) appears in the exported page at the displayed top-left (+10,+10) — verify via pdf.js render-free check: transform the path's first point back with `pdfToPage` ≈ (10,10)**; includeTextLayer → OCR word extractable, without → not; notebook export has template lines and no source.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. If fontkit cannot embed the @fontsource woff2 directly, add a build step that converts it to TTF (`wawoff2`) into `packages/pdf/assets/`, and record the ruling.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat(pdf): vector export with certification page`

---

### Task 10: Import / export UI, offline assets, end-to-end

**Files:**
- Create: `apps/web/src/components/ImportButton.svelte`, `apps/web/src/components/ExportDialog.svelte`, `apps/web/e2e/pdf.spec.ts`, `apps/web/e2e/fixtures/` (generated by the Task 3 builder during `globalSetup`)
- Modify: `apps/web/src/screens/Library.svelte` (import button + drag-and-drop onto the grid, progress, errors), `apps/web/src/screens/Editor.svelte` (export button `⤴ ส่งออก`), `apps/web/playwright.config.ts` (`globalSetup`), `scripts/check-no-external.mjs` (allowlist only if pdf.js/tesseract carry doc-link strings)

**Interfaces:**
- Consumes: Importer, OcrQueue, exportPdf, searchLibrary.
- Produces: user-visible copy (Thai):
  - Import errors: `not-pdf` → `ไฟล์นี้ไม่ใช่ PDF`; `password` → `PDF นี้มีรหัสผ่าน กรุณาปลดรหัสก่อนนำเข้า`; `corrupt` → `ไฟล์ PDF เสียหาย เปิดไม่ได้`; `unsupported-image` → `เปิดรูปภาพชนิดนี้ไม่ได้ในเบราว์เซอร์นี้`; `too-large` → `ไฟล์ใหญ่เกิน 1 GB`
  - Export dialog: checkbox `ใส่ข้อความที่ค้นหาได้ (จาก OCR)`; warning `ไฟล์ PDF ที่ส่งออกไม่ได้เข้ารหัส ผู้ที่ได้รับไฟล์จะเปิดอ่านได้ทันที`; buttons `ดาวน์โหลด` and, where `navigator.canShare({ files })`, `แชร์`
  - File name: `<title>_<YYYY-MM-DD>.pdf` with characters `\/:*?"<>|` replaced by `_`

- [ ] **Step 1: Write the failing e2e** `pdf.spec.ts` (system Chrome): import the 3-page fixture via the file chooser → document opens on page 1 and the PDF text is rendered (non-white pixels); draw a stroke; add a text box `ทดสอบข้อความ`; library search `EVIDENCE` (text from fixture page 2, pdf-text layer) lists the document with page 2; export → download event yields a PDF that (parsed in the test with pdf-lib) has 4 pages and contains `ทดสอบข้อความ`; import `notPdf` → shows `ไฟล์นี้ไม่ใช่ PDF` and the library still has one document; go offline, reload, unlock, open the document → page renders (pdf.js worker served from the service worker cache).
- [ ] **Step 2:** Run `npm run build && npm run e2e` → FAIL.
- [ ] **Step 3:** Implement UI and asset wiring.
- [ ] **Step 4:** Run `npm run build && npm run check:no-external && npm test && npm run e2e` → all PASS.
- [ ] **Step 5: Commit** `feat(web): import, export and search UI`

---

## Decisions this plan makes (for review)

- **Password-protected export PDF is not in Stage 2.** pdf-lib cannot encrypt; the spec allows exporting without a password when a clear warning is shown, so Stage 2 always shows that warning. Encrypted export (PDF password or encrypted `.pnote`) moves to Stage 4 with the `.pnote` work.
- **Importing password-protected PDFs is refused** with a message asking the user to remove the password first (pdf.js could open them with the password, but storing a decryptable copy would need the password kept somewhere).
- **Share-to-app (PWA share target)** moves to Stage 3, where Capacitor provides a reliable share intent on iOS and Android; Stage 2 imports via file picker and drag-and-drop.
- **Stroke files stay eagerly loaded** on open: page files exist only for annotated pages, so a 500-page PDF with notes on 20 pages loads 20 small files. The PDF itself is lazy.
- **OPFS is not used yet**: chunked records in IndexedDB already give range reads; OPFS can replace the adapter later without changing `BlobStore`.
