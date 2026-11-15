import type { Id, InputKind, PageRef, PenStyle, Shape, Stroke, Tool } from '@pnote/core/types';
import { shapePolyline } from './geometry';
import { strokeOutline } from './outline';
import { templateLines } from './templates';

/** screen = (pt * scale + offset) * dpr */
export interface Viewport { scale: number; offsetX: number; offsetY: number; dpr: number }

export function ptToScreen(v: Viewport, x: number, y: number): [number, number] {
  return [(x * v.scale + v.offsetX) * v.dpr, (y * v.scale + v.offsetY) * v.dpr];
}
export function screenToPt(v: Viewport, sx: number, sy: number): [number, number] {
  return [(sx / v.dpr - v.offsetX) / v.scale, (sy / v.dpr - v.offsetY) / v.scale];
}

const TEMPLATE_COLOR = '#c9d6e8';
const PAGE_COLOR = '#ffffff';

function fillPolygon(ctx: CanvasRenderingContext2D, poly: [number, number][]): void {
  if (!poly.length) return;
  ctx.beginPath();
  ctx.moveTo(poly[0][0], poly[0][1]);
  for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0], poly[i][1]);
  ctx.closePath();
  ctx.fill();
}

export class PageRenderer {
  private base: CanvasRenderingContext2D;
  private live: CanvasRenderingContext2D;
  private v: Viewport = { scale: 1, offsetX: 0, offsetY: 0, dpr: 1 };
  private cache = new Map<Id, { points: Float32Array; style: PenStyle; poly: [number, number][] }>();

  constructor(private baseCanvas: HTMLCanvasElement, private liveCanvas: HTMLCanvasElement) {
    this.base = baseCanvas.getContext('2d')!;
    this.live = liveCanvas.getContext('2d')!;
  }

  setViewport(v: Viewport): void { this.v = v; }

  private applyTransform(ctx: CanvasRenderingContext2D): void {
    const { scale, offsetX, offsetY, dpr } = this.v;
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, offsetX * dpr, offsetY * dpr);
  }

  private outlineFor(s: Stroke): [number, number][] {
    const hit = this.cache.get(s.id);
    if (hit && hit.points === s.points && hit.style === s.style) return hit.poly;
    const poly = strokeOutline(s.points, s.style, s.input);
    this.cache.set(s.id, { points: s.points, style: s.style, poly });
    return poly;
  }

  invalidate(strokeIds?: Id[]): void {
    if (!strokeIds) this.cache.clear();
    else strokeIds.forEach((id) => this.cache.delete(id));
  }

  renderPage(page: PageRef, strokes: Stroke[], shapes: Shape[]): void {
    const ctx = this.base;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.baseCanvas.width, this.baseCanvas.height);
    this.applyTransform(ctx);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = PAGE_COLOR;
    ctx.fillRect(0, 0, page.widthPt, page.heightPt);
    if (page.source.type === 'blank') {
      ctx.strokeStyle = TEMPLATE_COLOR;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      for (const l of templateLines(page.source.template, page.widthPt, page.heightPt)) {
        ctx.moveTo(l.x1, l.y1);
        ctx.lineTo(l.x2, l.y2);
      }
      ctx.stroke();
    }
    const visible = strokes.filter((s) => !s.hidden);
    const highlighters = visible.filter((s) => s.tool === 'highlighter');
    const pens = visible.filter((s) => s.tool !== 'highlighter');
    if (highlighters.length) {
      ctx.globalCompositeOperation = 'multiply';
      for (const s of highlighters) this.fillStroke(ctx, s);
    }
    ctx.globalCompositeOperation = 'source-over';
    for (const s of pens) this.fillStroke(ctx, s);
    for (const s of shapes) if (!s.hidden) this.strokeShape(ctx, s);
    ctx.globalAlpha = 1;
  }

  private fillStroke(ctx: CanvasRenderingContext2D, s: Stroke): void {
    ctx.globalAlpha = s.style.opacity;
    ctx.fillStyle = s.style.color;
    fillPolygon(ctx, this.outlineFor(s));
  }

  private strokeShape(ctx: CanvasRenderingContext2D, s: Shape): void {
    const xy = shapePolyline(s.geometry);
    ctx.globalAlpha = s.style.opacity;
    ctx.strokeStyle = s.style.color;
    ctx.lineWidth = s.style.width;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(xy[0], xy[1]);
    for (let i = 2; i < xy.length; i += 2) ctx.lineTo(xy[i], xy[i + 1]);
    if (s.geometry.kind === 'arrow') {
      const g = s.geometry;
      const ang = Math.atan2(g.y2 - g.y1, g.x2 - g.x1);
      const head = Math.max(6, s.style.width * 5);
      for (const d of [Math.PI * 0.85, -Math.PI * 0.85]) {
        ctx.moveTo(g.x2, g.y2);
        ctx.lineTo(g.x2 + head * Math.cos(ang + d), g.y2 + head * Math.sin(ang + d));
      }
    }
    ctx.stroke();
  }

  drawLive(points: Float32Array, tool: Tool, style: PenStyle, input: InputKind): void {
    const ctx = this.live;
    this.clearLive();
    this.applyTransform(ctx);
    ctx.globalCompositeOperation = tool === 'highlighter' ? 'multiply' : 'source-over';
    ctx.globalAlpha = style.opacity;
    ctx.fillStyle = style.color;
    fillPolygon(ctx, strokeOutline(points, style, input));
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  clearLive(): void {
    this.live.setTransform(1, 0, 0, 1, 0, 0);
    this.live.clearRect(0, 0, this.liveCanvas.width, this.liveCanvas.height);
  }
}
