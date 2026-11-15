import type { ShapeGeometry } from '@pnote/core/types';
import { distToSegment } from './geometry';

export const HOLD_MS = 500;
export const HOLD_TOLERANCE_PT = 2;

type P = [number, number];

/** True when the pen has stayed within HOLD_TOLERANCE_PT of the last sample for HOLD_MS up to nowT. */
export function isHolding(points: Float32Array, nowT: number): boolean {
  const n = Math.floor(points.length / 4);
  if (n === 0) return false;
  const lx = points[(n - 1) * 4], ly = points[(n - 1) * 4 + 1];
  let start = points[(n - 1) * 4 + 3];
  for (let i = n - 1; i >= 0; i--) {
    if (Math.hypot(points[i * 4] - lx, points[i * 4 + 1] - ly) > HOLD_TOLERANCE_PT) break;
    start = points[i * 4 + 3];
  }
  return nowT - start >= HOLD_MS;
}

function toPts(points: Float32Array): P[] {
  const out: P[] = [];
  for (let i = 0; i + 1 < points.length; i += 4) {
    const p: P = [points[i], points[i + 1]];
    const last = out[out.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
  }
  return out;
}

const dist = (a: P, b: P) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function pathLength(pts: P[]): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += dist(pts[i - 1], pts[i]);
  return l;
}

/** Ramer–Douglas–Peucker simplification. */
export function rdp(pts: P[], eps: number): P[] {
  if (pts.length < 3) return pts.slice();
  let maxD = 0, idx = 0;
  const a = pts[0], b = pts[pts.length - 1];
  for (let i = 1; i < pts.length - 1; i++) {
    const d = distToSegment(pts[i][0], pts[i][1], a[0], a[1], b[0], b[1]);
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD <= eps) return [a, b];
  return [...rdp(pts.slice(0, idx + 1), eps).slice(0, -1), ...rdp(pts.slice(idx), eps)];
}

function angleDeg(u: P, v: P): number {
  const c = (u[0] * v[0] + u[1] * v[1]) / (Math.hypot(...u) * Math.hypot(...v));
  return (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI;
}

const sub = (a: P, b: P): P => [a[0] - b[0], a[1] - b[1]];
const cross = (u: P, v: P) => u[0] * v[1] - u[1] * v[0];

function recognizeArrow(v: P[]): ShapeGeometry | null {
  if (v.length < 4 || v.length > 5) return null;
  const tail = v[0], tip = v[1];
  const shaft = dist(tail, tip);
  const back = sub(tail, tip);
  const barbs = v.slice(2).filter((p) => dist(p, tip) > shaft * 0.05);
  if (barbs.length !== 2) return null;
  for (const b of barbs) {
    const d = dist(b, tip);
    if (d > shaft / 2) return null;
    const a = angleDeg(back, sub(b, tip));
    if (a < 20 || a > 70) return null;
  }
  if (Math.sign(cross(back, sub(barbs[0], tip))) === Math.sign(cross(back, sub(barbs[1], tip)))) return null;
  return { kind: 'arrow', x1: tail[0], y1: tail[1], x2: tip[0], y2: tip[1] };
}

function ellipseFit(pts: P[]): { g: ShapeGeometry; spread: number } {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, rx = (maxX - minX) / 2, ry = (maxY - minY) / 2;
  if (rx === 0 || ry === 0) return { g: { kind: 'ellipse', cx, cy, rx, ry }, spread: Infinity };
  const r = pts.map(([x, y]) => Math.hypot((x - cx) / rx, (y - cy) / ry));
  const mean = r.reduce((a, b) => a + b, 0) / r.length;
  const sd = Math.sqrt(r.reduce((a, b) => a + (b - mean) ** 2, 0) / r.length);
  return { g: { kind: 'ellipse', cx, cy, rx, ry }, spread: sd / mean };
}

function corners(pts: P[], perimeter: number): P[] {
  // start at the point farthest from the centroid so the start lands on a corner
  const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length;
  const cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  let far = 0;
  pts.forEach((p, i) => { if (Math.hypot(p[0] - cx, p[1] - cy) > Math.hypot(pts[far][0] - cx, pts[far][1] - cy)) far = i; });
  const ring = [...pts.slice(far), ...pts.slice(0, far), pts[far]];
  return rdp(ring, perimeter * 0.05).slice(0, -1);
}

export const ELLIPSE_STRICT = 0.1;
export const ELLIPSE_LOOSE = 0.2;

export function recognizeShape(points: Float32Array): ShapeGeometry | null {
  const pts = toPts(points);
  if (pts.length < 2) return null;
  const L = pathLength(pts);
  if (L < 10) return null;
  const start = pts[0], end = pts[pts.length - 1];
  const closed = dist(start, end) < 0.15 * L;

  if (!closed) {
    const chord = dist(start, end);
    let dev = 0;
    for (const p of pts) dev = Math.max(dev, distToSegment(p[0], p[1], start[0], start[1], end[0], end[1]));
    if (chord > 0 && dev < 0.06 * chord) return { kind: 'line', x1: start[0], y1: start[1], x2: end[0], y2: end[1] };
    return recognizeArrow(rdp(pts, 0.04 * L));
  }

  const fit = ellipseFit(pts);
  if (fit.spread < ELLIPSE_STRICT) return fit.g;
  const c = corners(pts, L);
  if (c.length === 3) {
    return { kind: 'triangle', pts: [c[0][0], c[0][1], c[1][0], c[1][1], c[2][0], c[2][1]] };
  }
  if (c.length === 4) {
    const rightAngles = c.every((p, i) => {
      const a = angleDeg(sub(c[(i + 3) % 4], p), sub(c[(i + 1) % 4], p));
      return a >= 70 && a <= 110;
    });
    if (rightAngles) {
      const xs = c.map((p) => p[0]), ys = c.map((p) => p[1]);
      const x = Math.min(...xs), y = Math.min(...ys);
      return { kind: 'rect', x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
    }
  }
  return fit.spread < ELLIPSE_LOOSE ? fit.g : null;
}
