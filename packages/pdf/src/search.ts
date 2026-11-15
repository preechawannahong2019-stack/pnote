import type { DocumentMeta, Id, OcrPage, TextBox } from '@pnote/core/types';
import type { Library } from '@pnote/storage/library';

type Rect = [number, number, number, number];
const THAI = new RegExp(`[${String.fromCharCode(0x0e00)}-${String.fromCharCode(0x0e7f)}]`);

const ch = (c: number) => String.fromCharCode(c);
const TH = `${ch(0x0e00)}-${ch(0x0e7f)}`;
const ZERO_WIDTH = new RegExp(`[${ch(0x200b)}-${ch(0x200d)}${ch(0xfeff)}]`, 'g');
const THAI_DIGIT = new RegExp(`[${ch(0x0e50)}-${ch(0x0e59)}]`, 'g');
/** nikhahit (+ optional tone mark) + sara aa, as OCR often emits sara am */
const SARA_AM_SPLIT = new RegExp(`${ch(0x0e4d)}([${ch(0x0e48)}-${ch(0x0e4b)}]?)${ch(0x0e32)}`, 'g');
const THAI_GAP = new RegExp(`([${TH}])\\s+(?=[${TH}])`, 'g');

/** Normalise text so OCR output and typed queries compare equal. */
export function normalizeForSearch(s: string): string {
  return s
    .normalize('NFC')
    .toLowerCase()
    .replace(ZERO_WIDTH, '')
    .replace(THAI_DIGIT, (d) => String(d.charCodeAt(0) - 0x0e50))
    .replace(SARA_AM_SPLIT, `$1${ch(0x0e33)}`)
    .replace(THAI_GAP, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

interface Piece { text: string; rect: Rect }

/** Concatenate pieces with a space only where both sides are not Thai; remember each piece's range. */
function join(pieces: Piece[]): { text: string; ranges: [number, number, Rect][] } {
  let text = '';
  const ranges: [number, number, Rect][] = [];
  for (const p of pieces) {
    const t = normalizeForSearch(p.text);
    if (!t) continue;
    if (text && !(THAI.test(text[text.length - 1]) && THAI.test(t[0]))) text += ' ';
    ranges.push([text.length, text.length + t.length, p.rect]);
    text += t;
  }
  return { text, ranges };
}

export function searchPage(layer: OcrPage | null, textBoxes: TextBox[], query: string): { rects: Rect[]; snippet: string } | null {
  const q = normalizeForSearch(query);
  if (!q) return null;
  const sources: Piece[][] = [
    (layer?.words ?? []).map((w) => ({ text: w.text, rect: w.bbox })),
    ...textBoxes.filter((t) => !t.hidden).map((t) => [{ text: t.text, rect: [t.x, t.y, t.x + t.w, t.y + t.h] as Rect }]),
  ];
  const rects: Rect[] = [];
  let snippet = '';
  for (const pieces of sources) {
    const { text, ranges } = join(pieces);
    for (let at = text.indexOf(q); at >= 0; at = text.indexOf(q, at + q.length)) {
      for (const [s, e, r] of ranges) if (s < at + q.length && e > at && !rects.includes(r)) rects.push(r);
      if (!snippet) snippet = text.slice(Math.max(0, at - 30), at + q.length + 30);
    }
  }
  return rects.length ? { rects, snippet } : null;
}

export interface SearchHit { docId: Id; pageId: Id; pageIndex: number; rects: Rect[]; snippet: string }

export async function searchLibrary(lib: Library, query: string, opts: { limit?: number; signal?: AbortSignal } = {}): Promise<{ titleMatches: DocumentMeta[]; hits: SearchHit[] }> {
  const limit = opts.limit ?? 200;
  const titleMatches = await lib.searchByTitle(query);
  const hits: SearchHit[] = [];
  if (!normalizeForSearch(query)) return { titleMatches, hits };
  for (const meta of await lib.searchByTitle('')) {
    if (opts.signal?.aborted || hits.length >= limit) break;
    const withText = await lib.textLayerIds(meta.id);
    const { state } = await lib.openDocument(meta.id);
    for (const [i, page] of meta.pages.entries()) {
      if (opts.signal?.aborted || hits.length >= limit) break;
      const boxes = state.textBoxes?.[page.id] ?? [];
      if (!withText.has(page.id) && !boxes.length) continue;
      const layer = withText.has(page.id) ? await lib.getTextLayer(meta.id, page.id) : null;
      const r = searchPage(layer, boxes, query);
      if (r) hits.push({ docId: meta.id, pageId: page.id, pageIndex: i, ...r });
    }
  }
  return { titleMatches, hits };
}
