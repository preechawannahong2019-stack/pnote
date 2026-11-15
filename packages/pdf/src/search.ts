import type { DocumentMeta, Id, OcrPage, TextBox } from '@pnote/core/types';
import type { Library } from '@pnote/storage/library';

type Rect = [number, number, number, number];
const THAI = /[\u0E00-\u0E7F]/;

/** Normalise text so OCR output and typed queries compare equal. */
export function normalizeForSearch(s: string): string {
  return s
    .normalize('NFC')
    .toLowerCase()
    .replace(/[​-‍﻿]/g, '')
    .replace(/[๐-๙]/g, (d) => String(d.charCodeAt(0) - 0x0e50))
    .replace(/ํ([่-๋]?)า/g, '$1ำ') // nikhahit (+ tone) + sara aa -> tone + sara am
    .replace(/([฀-๿])\s+(?=[฀-๿])/g, '$1')
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
