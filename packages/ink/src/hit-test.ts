import type { Id, Shape, Stroke, TextBox } from '@pnote/core/types';
import { distToSegment, pointInPolygon, shapePolyline } from './geometry';

export interface BBox { minX: number; minY: number; maxX: number; maxY: number }

const bboxCache = new WeakMap<Float32Array, BBox>();

export function strokeBBox(s: Stroke): BBox {
  const hit = bboxCache.get(s.points);
  if (hit) return hit;
  const p = s.points;
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (let i = 0; i + 1 < p.length; i += 4) {
    if (p[i] < b.minX) b.minX = p[i];
    if (p[i] > b.maxX) b.maxX = p[i];
    if (p[i + 1] < b.minY) b.minY = p[i + 1];
    if (p[i + 1] > b.maxY) b.maxY = p[i + 1];
  }
  bboxCache.set(s.points, b);
  return b;
}

function polyBBox(xy: number[]): BBox {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (let i = 0; i < xy.length; i += 2) {
    b.minX = Math.min(b.minX, xy[i]); b.maxX = Math.max(b.maxX, xy[i]);
    b.minY = Math.min(b.minY, xy[i + 1]); b.maxY = Math.max(b.maxY, xy[i + 1]);
  }
  return b;
}

export function shapeBBox(s: Shape): BBox {
  return polyBBox(shapePolyline(s.geometry));
}

const near = (b: BBox, x: number, y: number, r: number) => x >= b.minX - r && x <= b.maxX + r && y >= b.minY - r && y <= b.maxY + r;

export function strokesNearPoint(x: number, y: number, radiusPt: number, strokes: Stroke[]): Id[] {
  const out: Id[] = [];
  for (const s of strokes) {
    if (s.hidden) continue;
    const r = radiusPt + s.style.width / 2;
    if (!near(strokeBBox(s), x, y, r)) continue;
    const p = s.points;
    if (p.length < 8) {
      if (Math.hypot(p[0] - x, p[1] - y) <= r) out.push(s.id);
      continue;
    }
    for (let i = 4; i + 1 < p.length; i += 4) {
      if (distToSegment(x, y, p[i - 4], p[i - 3], p[i], p[i + 1]) <= r) { out.push(s.id); break; }
    }
  }
  return out;
}

export function shapesNearPoint(x: number, y: number, radiusPt: number, shapes: Shape[]): Id[] {
  const out: Id[] = [];
  for (const s of shapes) {
    if (s.hidden) continue;
    const r = radiusPt + s.style.width / 2;
    const xy = shapePolyline(s.geometry);
    if (!near(polyBBox(xy), x, y, r)) continue;
    for (let i = 2; i + 1 < xy.length; i += 2) {
      if (distToSegment(x, y, xy[i - 2], xy[i - 1], xy[i], xy[i + 1]) <= r) { out.push(s.id); break; }
    }
  }
  return out;
}

export const LASSO_MIN_INSIDE = 0.5;

export function textBoxBBox(t: TextBox): BBox {
  return { minX: t.x, minY: t.y, maxX: t.x + t.w, maxY: t.y + t.h };
}

export function textBoxesAt(x: number, y: number, boxes: TextBox[]): Id[] {
  return boxes.filter((t) => !t.hidden && x >= t.x && x <= t.x + t.w && y >= t.y && y <= t.y + t.h).map((t) => t.id);
}

export function objectsInLasso(lasso: [number, number][], strokes: Stroke[], shapes: Shape[], textBoxes: TextBox[] = []): Id[] {
  const out: Id[] = [];
  for (const s of strokes) {
    if (s.hidden) continue;
    const p = s.points;
    let inside = 0, total = 0;
    for (let i = 0; i + 1 < p.length; i += 4) {
      total++;
      if (pointInPolygon(p[i], p[i + 1], lasso)) inside++;
    }
    if (total && inside / total >= LASSO_MIN_INSIDE) out.push(s.id);
  }
  for (const s of shapes) {
    if (s.hidden) continue;
    const b = shapeBBox(s);
    if (pointInPolygon((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, lasso)) out.push(s.id);
  }
  for (const t of textBoxes) {
    if (!t.hidden && pointInPolygon(t.x + t.w / 2, t.y + t.h / 2, lasso)) out.push(t.id);
  }
  return out;
}
