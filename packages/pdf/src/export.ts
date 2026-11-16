import fontkit from '@pdf-lib/fontkit';
import { BlendMode, degrees, PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { verifyAudit, type AuditEntry } from '@pnote/core/audit';
import type { DocState } from '@pnote/core/doc-state';
import type { Author, DocumentMeta, Id, OcrPage, PageRef, PdfPageBox, Shape, Stroke, TextBox } from '@pnote/core/types';
import { shapePolyline } from '@pnote/ink/geometry';
import { strokeOutline } from '@pnote/ink/outline';
import { TEXT_LINE_HEIGHT, wrapText } from '@pnote/ink/renderer';
import { templateLines } from '@pnote/ink/templates';
import { pageToPdf } from './page-box';

/** Sarabun subsets (WOFF): Thai and Latin are separate files in @fontsource. */
export interface ExportFonts { thai400: Uint8Array; thai700: Uint8Array; latin400: Uint8Array; latin700: Uint8Array }

export interface ExportInput {
  meta: DocumentMeta;
  state: DocState;
  audit: AuditEntry[];
  source: Uint8Array | null;
  images: Record<Id, { bytes: Uint8Array; mime: string }>; // keyed by page id; JPEG or PNG
  textLayers: Record<Id, OcrPage>;
  sourceIntact: boolean | null;
  exportedAt: number;
  exportedBy: Author;
  fonts: ExportFonts;
}
export interface ExportOptions { includeTextLayer: boolean; includeCertificate: boolean }

interface FontSet { thai: PDFFont; latin: PDFFont }

const THAI_CH = (c: string) => { const n = c.charCodeAt(0); return n >= 0x0e00 && n <= 0x0e7f; };

function hexColor(hex: string) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex) ?? [, '00', '00', '00'];
  return rgb(parseInt(m[1]!, 16) / 255, parseInt(m[2]!, 16) / 255, parseInt(m[3]!, 16) / 255);
}

/** Split text into runs drawn with the Thai or the Latin subset. */
function runs(text: string, f: FontSet): { text: string; font: PDFFont }[] {
  const out: { text: string; font: PDFFont }[] = [];
  for (const ch of Array.from(text)) {
    const font = THAI_CH(ch) ? f.thai : f.latin;
    const last = out[out.length - 1];
    if (last && last.font === font) last.text += ch;
    else out.push({ text: ch, font });
  }
  return out;
}

const widthOf = (text: string, f: FontSet, size: number) => runs(text, f).reduce((w, r) => w + r.font.widthOfTextAtSize(r.text, size), 0);

/** Draw mixed Thai/Latin text starting at a page-space baseline point, upright on the displayed page. */
function drawMixed(page: PDFPage, box: PdfPageBox, text: string, px: number, py: number, size: number, f: FontSet, color = rgb(0, 0, 0), opacity = 1): void {
  let x = px;
  for (const r of runs(text, f)) {
    const [X, Y] = pageToPdf(box, x, py);
    page.drawText(r.text, { x: X, y: Y, size, font: r.font, color, opacity, rotate: degrees(box.rotate) });
    x += r.font.widthOfTextAtSize(r.text, size);
  }
}

function pathD(box: PdfPageBox, pts: [number, number][], close: boolean): string {
  // drawSvgPath flips y around the origin we pass (0,0), so feed it user-space Y negated
  const parts = pts.map(([x, y], i) => {
    const [X, Y] = pageToPdf(box, x, y);
    return `${i ? 'L' : 'M'}${X.toFixed(2)} ${(-Y).toFixed(2)}`;
  });
  return parts.join(' ') + (close ? ' Z' : '');
}

function drawStroke(page: PDFPage, box: PdfPageBox, s: Stroke): void {
  const poly = strokeOutline(s.points, s.style, s.input);
  if (poly.length < 3) return;
  page.drawSvgPath(pathD(box, poly, true), {
    x: 0, y: 0, color: hexColor(s.style.color), opacity: s.style.opacity, borderWidth: 0,
    blendMode: s.tool === 'highlighter' ? BlendMode.Multiply : BlendMode.Normal,
  });
}

function drawShape(page: PDFPage, box: PdfPageBox, s: Shape): void {
  const xy = shapePolyline(s.geometry);
  const pts: [number, number][] = [];
  for (let i = 0; i < xy.length; i += 2) pts.push([xy[i], xy[i + 1]]);
  const opts = { x: 0, y: 0, borderColor: hexColor(s.style.color), borderWidth: s.style.width, borderOpacity: s.style.opacity };
  page.drawSvgPath(pathD(box, pts, false), opts);
  if (s.geometry.kind === 'arrow') {
    const g = s.geometry;
    const ang = Math.atan2(g.y2 - g.y1, g.x2 - g.x1);
    const head = Math.max(6, s.style.width * 5);
    for (const d of [Math.PI * 0.85, -Math.PI * 0.85]) {
      page.drawSvgPath(pathD(box, [[g.x2, g.y2], [g.x2 + head * Math.cos(ang + d), g.y2 + head * Math.sin(ang + d)]], false), opts);
    }
  }
}

function drawTextBox(page: PDFPage, box: PdfPageBox, t: TextBox, regular: FontSet, bold: FontSet): void {
  const f = t.bold ? bold : regular;
  const lines = wrapText((s) => widthOf(s, f, t.sizePt), t.text, t.w);
  lines.forEach((line, i) => {
    const baseline = t.y + i * t.sizePt * TEXT_LINE_HEIGHT + t.sizePt * 0.9;
    drawMixed(page, box, line, t.x, baseline, t.sizePt, f, hexColor(t.color));
  });
}

function drawTextLayer(page: PDFPage, box: PdfPageBox, layer: OcrPage, f: FontSet): void {
  for (const w of layer.words) {
    const [x0, y0, x1, y1] = w.bbox;
    const h = Math.max(1, y1 - y0);
    const natural = widthOf(w.text, f, h) || 1;
    const size = Math.max(1, Math.min(h, (h * (x1 - x0)) / natural));
    drawMixed(page, box, w.text, x0, y1 - h * 0.15, size, f, rgb(0, 0, 0), 0); // invisible but selectable/searchable
  }
}

const fmtTime = (t: number | undefined) => (t ? new Intl.DateTimeFormat('th-TH-u-ca-buddhist', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short' }).format(t) : '-');

/** Rows of the certification page (pure, used by the page and tests). */
/** A log is continuous only if it is non-empty, starts with the document's creation/import, and its hash chain verifies. */
export async function auditIntact(audit: AuditEntry[]): Promise<boolean> {
  if (!audit.length || (audit[0].action !== 'doc.create' && audit[0].action !== 'doc.import')) return false;
  return (await verifyAudit(audit)).ok;
}

/** auditOk: result of verifyAudit(input.audit) (async WebCrypto), passed in by the caller. */
export function certificateLines(input: ExportInput, auditOk: boolean): { label: string; value: string }[] {
  const { meta, audit, state } = input;
  const names = new Set<string>(audit.map((a) => a.profileName));
  for (const list of [...Object.values(state.strokes), ...Object.values(state.shapes), ...Object.values(state.textBoxes ?? {})]) {
    for (const o of list as { author: Author; hidden?: boolean }[]) if (!o.hidden) names.add(o.author.name);
  }
  const ok = auditOk;
  const integrity = input.sourceIntact === null ? '' : input.sourceIntact ? ' (ตรงกับต้นฉบับ)' : ' (ไม่ตรง — ต้นฉบับอาจถูกแก้ไข)';
  return [
    { label: 'ชื่อเอกสาร', value: meta.title },
    { label: 'แหล่งที่มา', value: meta.sourceUrl ?? meta.originalName ?? 'สมุดบันทึก' },
    { label: 'เวลานำเข้า', value: fmtTime(meta.importedAt ?? meta.createdAt) },
    { label: 'SHA-256 ต้นฉบับ', value: meta.sourceSha256 ? meta.sourceSha256 + integrity : '-' },
    { label: 'ผู้เขียน', value: [...names].join(', ') || '-' },
    { label: 'จำนวนการแก้ไข', value: String(audit.length) },
    { label: 'hash ล่าสุดของประวัติ', value: audit[audit.length - 1]?.hash ?? '-' },
    { label: 'ผลตรวจประวัติการแก้ไข', value: ok ? 'ต่อเนื่อง' : 'ไม่ต่อเนื่อง' },
    { label: 'เวลาส่งออก', value: fmtTime(input.exportedAt) },
    { label: 'ผู้ส่งออก', value: input.exportedBy.name },
  ];
}

function drawCertificate(doc: PDFDocument, lines: { label: string; value: string }[], regular: FontSet, bold: FontSet): void {
  const page = doc.addPage([595.28, 841.89]);
  const box: PdfPageBox = { x: 0, y: 0, w: 595.28, h: 841.89, rotate: 0 };
  let y = 80;
  drawMixed(page, box, 'ข้อมูลรับรองเอกสาร', 56, y, 22, bold);
  y += 40;
  const valueX = 210, maxW = 595.28 - valueX - 56;
  for (const { label, value } of lines) {
    drawMixed(page, box, label, 56, y, 12, bold);
    const wrapped = wrapText((s) => widthOf(s, regular, 12), value, maxW);
    wrapped.forEach((l, i) => drawMixed(page, box, l, valueX, y + i * 18, 12, regular));
    y += Math.max(1, wrapped.length) * 18 + 8;
  }
  drawMixed(page, box, 'เวลาทั้งหมดอ้างอิงนาฬิกาของเครื่อง', 56, y + 16, 10, regular, rgb(0.35, 0.35, 0.35));
}

const blankBox = (p: PageRef): PdfPageBox => ({ x: 0, y: 0, w: p.widthPt, h: p.heightPt, rotate: 0 });

export class ExportSourceMissing extends Error {
  constructor() { super('the original source of this document is missing'); this.name = 'ExportSourceMissing'; }
}

export async function exportPdf(input: ExportInput, opts: ExportOptions): Promise<Uint8Array> {
  const { meta, state } = input;
  const needsSource = state.pages.some((p) => p.source.type === 'pdf');
  const needsImages = state.pages.some((p) => p.source.type === 'image' && !input.images[p.id]);
  if ((needsSource && !input.source) || needsImages) throw new ExportSourceMissing();
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const regular: FontSet = { thai: await doc.embedFont(input.fonts.thai400, { subset: true }), latin: await doc.embedFont(input.fonts.latin400, { subset: true }) };
  const bold: FontSet = { thai: await doc.embedFont(input.fonts.thai700, { subset: true }), latin: await doc.embedFont(input.fonts.latin700, { subset: true }) };
  doc.setTitle(meta.title);
  doc.setProducer('PNote');

  const src = input.source ? await PDFDocument.load(input.source, { updateMetadata: false }) : null;
  const pdfPages = state.pages.filter((p) => p.source.type === 'pdf');
  const copied = src && pdfPages.length ? await doc.copyPages(src, pdfPages.map((p) => (p.source as { pageNo: number }).pageNo - 1)) : [];
  let ci = 0;

  for (const p of state.pages) {
    let page: PDFPage;
    let box: PdfPageBox;
    if (p.source.type === 'pdf' && copied[ci]) {
      page = doc.addPage(copied[ci++]);
      box = p.pdfBox ?? blankBox(p);
    } else {
      page = doc.addPage([p.widthPt, p.heightPt]);
      box = blankBox(p);
      if (p.source.type === 'blank') {
        for (const l of templateLines(p.source.template, p.widthPt, p.heightPt)) {
          page.drawSvgPath(pathD(box, [[l.x1, l.y1], [l.x2, l.y2]], false), { x: 0, y: 0, borderColor: rgb(0.79, 0.84, 0.91), borderWidth: 0.5 });
        }
      } else if (p.source.type === 'image') {
        const img = input.images[p.id];
        if (img) {
          const embedded = img.mime === 'image/png' ? await doc.embedPng(img.bytes) : await doc.embedJpg(img.bytes);
          page.drawImage(embedded, { x: 0, y: 0, width: p.widthPt, height: p.heightPt });
        }
      }
    }
    const strokes = (state.strokes[p.id] ?? []).filter((s) => !s.hidden);
    for (const s of strokes.filter((s) => s.tool === 'highlighter')) drawStroke(page, box, s);
    for (const s of strokes.filter((s) => s.tool !== 'highlighter')) drawStroke(page, box, s);
    for (const s of (state.shapes[p.id] ?? []).filter((s) => !s.hidden)) drawShape(page, box, s);
    for (const t of (state.textBoxes?.[p.id] ?? []).filter((t) => !t.hidden)) drawTextBox(page, box, t, regular, bold);
    const layer = input.textLayers[p.id];
    if (opts.includeTextLayer && layer && layer.engine === 'tesseract') drawTextLayer(page, box, layer, regular);
  }

  if (opts.includeCertificate) {
    const auditOk = await auditIntact(input.audit);
    drawCertificate(doc, certificateLines(input, auditOk), regular, bold);
  }
  return doc.save();
}

/**
 * Characters in visible text boxes that neither bundled Sarabun subset (Thai, Latin) can draw.
 * They would export as empty glyphs, so the export dialog warns about them, per page.
 */
export async function missingGlyphs(state: DocState, fonts: ExportFonts): Promise<{ pageIndex: number; chars: string[] }[]> {
  const faces = [fontkit.create(fonts.thai400 as never), fontkit.create(fonts.latin400 as never)] as unknown as { hasGlyphForCodePoint(cp: number): boolean }[];
  const out: { pageIndex: number; chars: string[] }[] = [];
  state.pages.forEach((page, pageIndex) => {
    const missing = new Set<string>();
    for (const b of state.textBoxes?.[page.id] ?? []) {
      if (b.hidden) continue;
      for (const ch of b.text) {
        if (/\s/.test(ch)) continue;
        const cp = ch.codePointAt(0)!;
        if (!faces.some((f) => f.hasGlyphForCodePoint(cp))) missing.add(ch);
      }
    }
    if (missing.size) out.push({ pageIndex, chars: [...missing] });
  });
  return out;
}
