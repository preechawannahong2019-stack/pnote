import type { PageRef, PenStyle, Shape, Stroke } from '../src/types';
import type { DocState } from '../src/doc-state';

export const style: PenStyle = { color: '#000', width: 2, opacity: 1, pressureCurve: 'normal', taperStart: 0, taperEnd: 0, smoothing: 0.5 };
export const author = { profileId: 'p1', name: 'A' };
export function page(id: string): PageRef {
  return { id, source: { type: 'blank', template: 'plain' }, widthPt: 595.28, heightPt: 841.89 };
}
export function stroke(id: string, pageId = 'pg1', pts: number[] = [0, 0, 0.5, 0, 10, 10, 0.5, 10]): Stroke {
  return { id, pageId, tool: 'pen', style, points: new Float32Array(pts), input: 'pen', author, createdAt: 1 };
}
export function rectShape(id: string, sourceStrokeId: string, pageId = 'pg1'): Shape {
  return { id, pageId, geometry: { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }, style, sourceStrokeId, author, createdAt: 1 };
}
export function emptyState(...pageIds: string[]): DocState {
  const ids = pageIds.length ? pageIds : ['pg1'];
  return { pages: ids.map(page), strokes: Object.fromEntries(ids.map((i) => [i, []])), shapes: Object.fromEntries(ids.map((i) => [i, []])) };
}
