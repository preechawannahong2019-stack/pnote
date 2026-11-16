import type { ShapeGeometry } from '@pnote/core/types';

export function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function segmentsIntersect(a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number): boolean {
  const o = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) => Math.sign((qx - px) * (ry - py) - (qy - py) * (rx - px));
  const o1 = o(a, b, c, d, e, f), o2 = o(a, b, c, d, g, h), o3 = o(e, f, g, h, a, b), o4 = o(e, f, g, h, c, d);
  return o1 !== o2 && o3 !== o4;
}

export function pointInPolygon(x: number, y: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Polyline (flat x,y pairs) approximating a shape's outline. */
export function shapePolyline(g: ShapeGeometry): number[] {
  switch (g.kind) {
    case 'line':
    case 'arrow':
      return [g.x1, g.y1, g.x2, g.y2];
    case 'rect':
      return [g.x, g.y, g.x + g.w, g.y, g.x + g.w, g.y + g.h, g.x, g.y + g.h, g.x, g.y];
    case 'triangle': {
      const p = g.pts;
      return [p[0], p[1], p[2], p[3], p[4], p[5], p[0], p[1]];
    }
    case 'ellipse': {
      const out: number[] = [];
      for (let i = 0; i <= 48; i++) {
        const a = (i / 48) * Math.PI * 2;
        out.push(g.cx + g.rx * Math.cos(a), g.cy + g.ry * Math.sin(a));
      }
      return out;
    }
  }
}
