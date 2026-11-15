import { readFileSync } from 'node:fs';
import { appendAudit, type AuditEntry } from '@pnote/core/audit';
import type { DocState } from '@pnote/core/doc-state';
import type { DocumentMeta, OcrPage, PageRef, Stroke, TextBox } from '@pnote/core/types';
import { PDFDocument } from 'pdf-lib';
import { certificateLines, exportPdf, type ExportFonts, type ExportInput } from '../src/export';
import { pdfToPage } from '../src/page-box';
import { pdfjs, configurePdfjs } from '../src/pdfjs';
import { readPdfInfo } from '../src/pdf-source';
import { croppedPdf, plainPdf, rotatedPdf } from './fixtures/make-fixtures';

const font = (f: string) => new Uint8Array(readFileSync(new URL(`../../../node_modules/@fontsource/sarabun/files/sarabun-${f}-normal.woff`, import.meta.url)));
const fonts: ExportFonts = { thai400: font('thai-400'), thai700: font('thai-700'), latin400: font('latin-400'), latin700: font('latin-700') };
const author = { profileId: 'p1', name: 'สมชาย' };
const style = { color: '#1a1a1a', width: 2, opacity: 1, pressureCurve: 'off' as const, taperStart: 0, taperEnd: 0, smoothing: 0.5 };
const dot = (id: string, pageId: string, x: number, y: number, extra: Partial<Stroke> = {}): Stroke => ({ id, pageId, tool: 'pen', style, points: new Float32Array([x, y, 0.5, 0, x + 0.5, y, 0.5, 8]), input: 'pen', author, createdAt: 1, ...extra });
const tbox = (pageId: string, text: string): TextBox => ({ id: 't1', pageId, x: 50, y: 100, w: 300, h: 30, text, font: 'sarabun', sizePt: 16, color: '#000', bold: false, author, createdAt: 1, updatedAt: 1 });

async function pdfInput(bytes: Uint8Array, opts: { strokes?: (pages: PageRef[]) => Record<string, Stroke[]>; texts?: (pages: PageRef[]) => Record<string, TextBox[]>; layers?: (pages: PageRef[]) => Record<string, OcrPage>; audit?: AuditEntry[]; intact?: boolean | null } = {}): Promise<ExportInput> {
  const info = await readPdfInfo({ size: bytes.length, slice: async (s, e) => bytes.slice(s, e) });
  const pages: PageRef[] = info.map((p) => ({ id: `pg${p.pageNo}`, source: { type: 'pdf', pageNo: p.pageNo }, widthPt: p.widthPt, heightPt: p.heightPt, pdfBox: p.box }));
  const meta: DocumentMeta = { id: 'd1', profileId: 'p1', folderId: null, title: 'คำให้การ', kind: 'pdf', originalName: 'คำให้การ.pdf', importedAt: Date.UTC(2026, 10, 15, 3, 0), sourceSha256: 'ab'.repeat(32), pages, createdAt: 1, updatedAt: 1 };
  const state: DocState = { pages, strokes: opts.strokes?.(pages) ?? {}, shapes: {}, textBoxes: opts.texts?.(pages) ?? {} };
  const audit = opts.audit ?? (await appendAudit([], { time: 1, author, action: 'doc.import', objectIds: ['d1'] }));
  return { meta, state, audit, source: bytes, images: {}, textLayers: opts.layers?.(pages) ?? {}, sourceIntact: opts.intact === undefined ? true : opts.intact, exportedAt: Date.UTC(2026, 10, 15, 6, 30), exportedBy: author, fonts };
}

async function texts(pdf: Uint8Array, pageNo: number): Promise<string> {
  configurePdfjs();
  const doc = await pdfjs.getDocument({ data: pdf.slice(), verbosity: 0 }).promise;
  const page = await doc.getPage(pageNo);
  const t = (await page.getTextContent()).items.map((i) => ('str' in i ? i.str : '')).join('');
  await doc.loadingTask.destroy();
  return t;
}

async function pathBoxes(pdf: Uint8Array, pageNo: number): Promise<number[][]> {
  configurePdfjs();
  const doc = await pdfjs.getDocument({ data: pdf.slice(), verbosity: 0 }).promise;
  const page = await doc.getPage(pageNo);
  const ops = await page.getOperatorList();
  const out: number[][] = [];
  // track the current transformation matrix so path boxes come back in PDF user space
  type M = [number, number, number, number, number, number];
  const mul = (a: M, b: M): M => [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3], a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]];
  let ctm: M = [1, 0, 0, 1, 0, 0];
  const stack: M[] = [];
  ops.fnArray.forEach((fn, i) => {
    const args = ops.argsArray[i] as unknown[];
    if (fn === pdfjs.OPS.save) stack.push(ctm);
    else if (fn === pdfjs.OPS.restore) ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
    else if (fn === pdfjs.OPS.transform) ctm = mul(args as unknown as M, ctm);
    else if (fn === pdfjs.OPS.constructPath) {
      const mm = args[args.length - 1] as ArrayLike<number> | null;
      if (mm && mm.length === 4) {
        const pts = [[mm[0], mm[1]], [mm[2], mm[3]]].map(([x, y]) => [ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]]);
        out.push([Math.min(pts[0][0], pts[1][0]), Math.min(pts[0][1], pts[1][1]), Math.max(pts[0][0], pts[1][0]), Math.max(pts[0][1], pts[1][1])]);
      }
    }
  });
  const images = ops.fnArray.filter((f) => f === pdfjs.OPS.paintImageXObject).length;
  await doc.loadingTask.destroy();
  return images ? [[-1, images]] : out;
}

describe('exportPdf', () => {
  it('keeps the original pages, adds a certificate page, and draws strokes as vector paths', async () => {
    const src = await plainPdf(3);
    const out = await exportPdf(await pdfInput(src, { strokes: (p) => ({ pg1: [dot('s1', 'pg1', 100, 100)] }) }), { includeTextLayer: false, includeCertificate: true });
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(4);
    const orig = await PDFDocument.load(src);
    for (let i = 0; i < 3; i++) expect(doc.getPage(i).getMediaBox()).toEqual(orig.getPage(i).getMediaBox());
    const boxes = await pathBoxes(out, 1);
    expect(boxes.length).toBeGreaterThan(0);
    expect(boxes[0][0]).not.toBe(-1); // not an image
  });

  it('does not export hidden strokes', async () => {
    const src = await plainPdf(1);
    const out = await exportPdf(await pdfInput(src, { strokes: () => ({ pg1: [dot('s1', 'pg1', 100, 100, { hidden: true })] }) }), { includeTextLayer: false, includeCertificate: true });
    expect(await pathBoxes(out, 1)).toEqual([]);
  });

  it('writes text boxes as extractable Thai text', async () => {
    const src = await plainPdf(1);
    const out = await exportPdf(await pdfInput(src, { texts: () => ({ pg1: [tbox('pg1', 'ผู้ต้องหา 2 คน')] }) }), { includeTextLayer: false, includeCertificate: true });
    expect((await texts(out, 1)).replace(/\s/g, '')).toContain('ผู้ต้องหา2คน');
  });

  it('certificate shows hash, integrity, authors and audit check', async () => {
    const src = await plainPdf(1);
    const input = await pdfInput(src);
    const out = await exportPdf(input, { includeTextLayer: false, includeCertificate: true });
    const t = (await texts(out, 2)).replace(/\s/g, '');
    expect(t).toContain('ข้อมูลรับรองเอกสาร');
    expect(t).toContain('ab'.repeat(32));
    expect(t).toContain('ตรงกับต้นฉบับ');
    expect(t).toContain('สมชาย');
    expect(t).toContain('ต่อเนื่อง');
    expect(t).toContain('เวลาทั้งหมดอ้างอิงนาฬิกาของเครื่อง');
  });

  it('certificate flags a changed original and a broken audit', async () => {
    const src = await plainPdf(1);
    const audit = await appendAudit([], { time: 1, author, action: 'doc.import', objectIds: ['d1'] });
    audit[0] = { ...audit[0], objectIds: ['forged'] };
    const lines = certificateLines(await pdfInput(src, { intact: false, audit }), false);
    const all = lines.map((l) => `${l.label}:${l.value}`).join('|');
    expect(all).toContain('ไม่ตรง');
    expect(all).toContain('ไม่ต่อเนื่อง');
  });

  it.each([
    ['rotated', rotatedPdf],
    ['cropped', croppedPdf],
  ] as const)('places ink at the same displayed spot on a %s page', async (_n, make) => {
    const src = await make();
    const input = await pdfInput(src, { strokes: () => ({ pg1: [dot('s1', 'pg1', 40, 30)] }) });
    const out = await exportPdf(input, { includeTextLayer: false, includeCertificate: false });
    const [b] = await pathBoxes(out, 1);
    const [cx, cy] = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
    const [px, py] = pdfToPage(input.meta.pages[0].pdfBox!, cx, cy);
    expect(px).toBeCloseTo(40, -0.5);
    expect(py).toBeCloseTo(30, -0.5);
  });

  it('adds an OCR text layer only when asked', async () => {
    const src = await plainPdf(1);
    const layers = () => ({ pg1: { pageId: 'pg1', engine: 'tesseract' as const, lang: 'tha+eng' as const, doneAt: 1, words: [{ text: 'สแกนแล้ว', bbox: [100, 200, 160, 215] as [number, number, number, number], conf: 90 }] } });
    const withLayer = await exportPdf(await pdfInput(src, { layers }), { includeTextLayer: true, includeCertificate: false });
    const without = await exportPdf(await pdfInput(src, { layers }), { includeTextLayer: false, includeCertificate: false });
    expect(await texts(withLayer, 1)).toContain('สแกนแล้ว');
    expect(await texts(without, 1)).not.toContain('สแกนแล้ว');
  });

  it('exports a notebook with template lines and no source', async () => {
    const page: PageRef = { id: 'n1', source: { type: 'blank', template: 'lined' }, widthPt: 595.28, heightPt: 841.89 };
    const meta: DocumentMeta = { id: 'n', profileId: 'p1', folderId: null, title: 'สมุด', kind: 'notebook', pages: [page], createdAt: 1, updatedAt: 1 };
    const input: ExportInput = { meta, state: { pages: [page], strokes: {}, shapes: {}, textBoxes: {} }, audit: [], source: null, images: {}, textLayers: {}, sourceIntact: null, exportedAt: 1, exportedBy: author, fonts };
    const out = await exportPdf(input, { includeTextLayer: false, includeCertificate: true });
    expect((await PDFDocument.load(out)).getPageCount()).toBe(2);
    expect((await pathBoxes(out, 1)).length).toBeGreaterThan(0);
    expect((await texts(out, 2)).replace(/\s/g, '')).toContain('สมุดบันทึก');
  });
});

describe('review fixes: certificate honesty', () => {
  it('an empty audit log is not reported as continuous', async () => {
    const out = await exportPdf(await pdfInput(await plainPdf(1), { audit: [] }), { includeTextLayer: false, includeCertificate: true });
    const t = await texts(out, 2);
    expect(t).toContain('ไม่ต่อเนื่อง');
  });

  it('a log that does not start with doc.create or doc.import is not continuous', async () => {
    const audit = await appendAudit([], { time: 1, author, action: 'stroke.add', objectIds: ['s1'] });
    const out = await exportPdf(await pdfInput(await plainPdf(1), { audit }), { includeTextLayer: false, includeCertificate: true });
    expect(await texts(out, 2)).toContain('ไม่ต่อเนื่อง');
  });

  it('refuses to export a PDF document whose source is missing', async () => {
    const input = await pdfInput(await plainPdf(1));
    await expect(exportPdf({ ...input, source: null }, { includeTextLayer: false, includeCertificate: true })).rejects.toThrow(/source/i);
  });
});

describe('review fixes: characters the bundled fonts cannot draw', () => {
  it('lists characters outside the Sarabun subsets, per page', async () => {
    const { missingGlyphs } = await import('../src/export');
    const input = await pdfInput(await plainPdf(1), { texts: () => ({ pg1: [tbox('pg1', '王小明 Nguyễn ผู้ต้องหา Smith')] }) });
    const res = await missingGlyphs(input.state, fonts);
    expect(res).toHaveLength(1);
    expect(res[0].pageIndex).toBe(0);
    for (const ch of ['王', '小', '明', 'ễ']) expect(res[0].chars).toContain(ch);
    for (const ch of ['ผ', 'S', ' ']) expect(res[0].chars).not.toContain(ch);
  });

  it('reports nothing for Thai and English only', async () => {
    const { missingGlyphs } = await import('../src/export');
    const input = await pdfInput(await plainPdf(1), { texts: () => ({ pg1: [tbox('pg1', 'ผู้ต้องหา ๒ คน Smith 2569')] }) });
    expect(await missingGlyphs(input.state, fonts)).toEqual([]);
  });
});

describe('stage 3: web capture export', () => {
  it('puts the URL and capture time on every page and the capture hashes on the certificate', async () => {
    const base = await pdfInput(await plainPdf(2));
    const capture = { requestedUrl: 'https://a.go.th/x', finalUrl: 'https://a.go.th/x?y=1', capturedAt: Date.UTC(2026, 10, 15, 3, 0), timeZone: 'Asia/Bangkok', userAgent: 'UA',
      files: [{ name: 'page.pdf' as const, sha256: 'p'.repeat(64), bytes: 1 }, { name: 'screenshot.png' as const, sha256: 's'.repeat(64), bytes: 1 }, { name: 'page.mht' as const, sha256: 'm'.repeat(64), bytes: 1 }] };
    const input = { ...base, meta: { ...base.meta, kind: 'web' as const, sourceUrl: capture.finalUrl, capturedAt: capture.capturedAt }, capture };
    const out = await exportPdf(input, { includeTextLayer: false, includeCertificate: true });
    for (const n of [1, 2]) expect(await texts(out, n)).toContain('ที่มา: https://a.go.th/x?y=1');
    const cert = await texts(out, 3);
    expect(cert).toContain('https://a.go.th/x');
    expect(cert).toContain('s'.repeat(64));
    expect(cert).toContain('m'.repeat(64));
  });
});
