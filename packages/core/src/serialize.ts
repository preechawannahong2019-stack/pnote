import type { Shape, Stroke } from './types';

/**
 * Layout: "PNP1" · u32 headerLength · JSON header · padding to 4 bytes · Float32 points of every stroke in order.
 * Header strokes carry `n` (float count) instead of `points`.
 */
const MAGIC = [0x50, 0x4e, 0x50, 0x31];

type HeaderStroke = Omit<Stroke, 'points'> & { n: number };

export function encodePage(strokes: Stroke[], shapes: Shape[]): Uint8Array {
  const header = {
    strokes: strokes.map(({ points, ...rest }): HeaderStroke => ({ ...rest, n: points.length })),
    shapes,
  };
  const json = new TextEncoder().encode(JSON.stringify(header));
  const dataStart = Math.ceil((8 + json.length) / 4) * 4;
  const floats = strokes.reduce((a, s) => a + s.points.length, 0);
  const out = new Uint8Array(dataStart + floats * 4);
  out.set(MAGIC, 0);
  new DataView(out.buffer).setUint32(4, json.length, true);
  out.set(json, 8);
  const f = new Float32Array(out.buffer, dataStart, floats);
  let off = 0;
  for (const s of strokes) { f.set(s.points, off); off += s.points.length; }
  return out;
}

export function decodePage(b: Uint8Array): { strokes: Stroke[]; shapes: Shape[] } {
  if (MAGIC.some((m, i) => b[i] !== m)) throw new Error('not a page file');
  const bytes = b.byteOffset % 4 === 0 ? b : b.slice();
  const len = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + len))) as { strokes: HeaderStroke[]; shapes: Shape[] };
  const dataStart = Math.ceil((8 + len) / 4) * 4;
  let off = bytes.byteOffset + dataStart;
  const strokes = header.strokes.map(({ n, ...rest }) => {
    const points = new Float32Array(bytes.buffer.slice(off, off + n * 4));
    off += n * 4;
    return { ...rest, points } as Stroke;
  });
  return { strokes, shapes: header.shapes };
}
