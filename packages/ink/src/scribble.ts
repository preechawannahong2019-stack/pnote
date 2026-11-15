import type { Id, Shape, Stroke, TextBox } from '@pnote/core/types';
import { distToSegment, segmentsIntersect, shapePolyline } from './geometry';
import { shapeBBox, strokeBBox, textBoxBBox, type BBox } from './hit-test';

export const SCRIBBLE_MIN_REVERSALS = 3;
export const SCRIBBLE_MIN_LEG_PT = 4;
export const SCRIBBLE_MIN_DENSITY = 2.5;

function xyOf(points: Float32Array): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < points.length; i += 4) out.push(points[i], points[i + 1]);
  return out;
}

function bboxOf(xy: number[]): BBox {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (let i = 0; i < xy.length; i += 2) {
    b.minX = Math.min(b.minX, xy[i]); b.maxX = Math.max(b.maxX, xy[i]);
    b.minY = Math.min(b.minY, xy[i + 1]); b.maxY = Math.max(b.maxY, xy[i + 1]);
  }
  return b;
}

/** Unit vector of the principal axis (PCA) of the points. */
function principalAxis(xy: number[]): [number, number] {
  const n = xy.length / 2;
  let mx = 0, my = 0;
  for (let i = 0; i < xy.length; i += 2) { mx += xy[i]; my += xy[i + 1]; }
  mx /= n; my /= n;
  let sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < xy.length; i += 2) {
    const dx = xy[i] - mx, dy = xy[i + 1] - my;
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return [Math.cos(angle), Math.sin(angle)];
}

export function countReversals(xy: number[]): number {
  const [ax, ay] = principalAxis(xy);
  let dir = 0;
  let extreme = xy[0] * ax + xy[1] * ay;
  let reversals = 0;
  for (let i = 2; i < xy.length; i += 2) {
    const v = xy[i] * ax + xy[i + 1] * ay;
    if (dir === 0) {
      if (Math.abs(v - extreme) >= SCRIBBLE_MIN_LEG_PT) { dir = Math.sign(v - extreme); extreme = v; }
      continue;
    }
    if ((v - extreme) * dir > 0) extreme = v;
    else if (Math.abs(v - extreme) >= SCRIBBLE_MIN_LEG_PT) { reversals++; dir = -dir; extreme = v; }
  }
  return reversals;
}

export function isScribble(points: Float32Array): boolean {
  const xy = xyOf(points);
  if (xy.length < 8) return false;
  if (countReversals(xy) < SCRIBBLE_MIN_REVERSALS) return false;
  let length = 0;
  for (let i = 2; i < xy.length; i += 2) length += Math.hypot(xy[i] - xy[i - 2], xy[i + 1] - xy[i - 1]);
  const b = bboxOf(xy);
  const diag = Math.hypot(b.maxX - b.minX, b.maxY - b.minY);
  return diag > 0 && length / diag >= SCRIBBLE_MIN_DENSITY;
}

const overlaps = (a: BBox, b: BBox, pad: number) =>
  a.minX - pad <= b.maxX && a.maxX + pad >= b.minX && a.minY - pad <= b.maxY && a.maxY + pad >= b.minY;

function crosses(scribble: number[], target: number[], halfWidth: number): boolean {
  for (let i = 2; i < scribble.length; i += 2) {
    for (let j = 2; j < target.length; j += 2) {
      if (segmentsIntersect(scribble[i - 2], scribble[i - 1], scribble[i], scribble[i + 1], target[j - 2], target[j - 1], target[j], target[j + 1])) return true;
    }
  }
  for (let i = 0; i < scribble.length; i += 2) {
    for (let j = 2; j < target.length; j += 2) {
      if (distToSegment(scribble[i], scribble[i + 1], target[j - 2], target[j - 1], target[j], target[j + 1]) <= halfWidth) return true;
    }
  }
  if (target.length === 2) {
    for (let i = 2; i < scribble.length; i += 2) {
      if (distToSegment(target[0], target[1], scribble[i - 2], scribble[i - 1], scribble[i], scribble[i + 1]) <= halfWidth) return true;
    }
  }
  return false;
}

export function scribbleTargets(points: Float32Array, strokes: Stroke[], shapes: Shape[], textBoxes: TextBox[] = []): Id[] {
  const xy = xyOf(points);
  const sb = bboxOf(xy);
  const out: Id[] = [];
  for (const s of strokes) {
    if (s.hidden || !overlaps(sb, strokeBBox(s), s.style.width)) continue;
    if (crosses(xy, xyOf(s.points), s.style.width / 2)) out.push(s.id);
  }
  for (const s of shapes) {
    if (s.hidden || !overlaps(sb, shapeBBox(s), s.style.width)) continue;
    if (crosses(xy, shapePolyline(s.geometry), s.style.width / 2)) out.push(s.id);
  }
  for (const t of textBoxes) {
    if (t.hidden) continue;
    const b = textBoxBBox(t);
    if (!overlaps(sb, b, 0)) continue;
    // count the scribble points inside the box: a scribble across a text box mostly lies inside it
    let inside = 0;
    for (let i = 0; i < xy.length; i += 2) if (xy[i] >= b.minX && xy[i] <= b.maxX && xy[i + 1] >= b.minY && xy[i + 1] <= b.maxY) inside++;
    if (inside / (xy.length / 2) >= 0.5) out.push(t.id);
  }
  return out;
}
