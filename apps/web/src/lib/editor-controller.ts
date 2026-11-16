import { newId } from '@pnote/core/ids';
import type { Id, InputKind, PageTemplate, PenPreset, PenStyle, Shape, Stroke } from '@pnote/core/types';
import { objectsInLasso, shapeBBox, shapesNearPoint, strokeBBox, strokesNearPoint, type BBox } from '@pnote/ink/hit-test';
import type { InputMode, RouterAction } from '@pnote/ink/input-router';
import { DEFAULT_HIGHLIGHTER, DEFAULT_PEN, clampStyle } from '@pnote/ink/outline';
import { isScribble, scribbleTargets } from '@pnote/ink/scribble';
import { isHolding, recognizeShape } from '@pnote/ink/shapes';
import { blankPage } from '@pnote/storage/library';
import type { EditorSession } from './session';

/** Bounding box of the selected objects (no argument spreading, safe for huge strokes). */
export function selectionBounds(strokes: Stroke[], shapes: Shape[], ids: Id[]): BBox | null {
  const want = new Set(ids);
  const boxes = [...strokes.filter((s) => want.has(s.id) && !s.hidden).map(strokeBBox), ...shapes.filter((s) => want.has(s.id) && !s.hidden).map(shapeBBox)];
  if (!boxes.length) return null;
  return boxes.reduce((a, b) => ({ minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) }));
}

export type ActiveTool = 'pen' | 'highlighter' | 'eraser' | 'lasso';
export const ERASER_RADIUS_PT = 6;
const SELECTION_PAD_PT = 10;

interface Live { pageId: Id; input: InputKind; points: number[]; dragFrom?: [number, number]; erased?: Set<Id> }

export class EditorController {
  mode: InputMode = 'pen';
  tool: ActiveTool = 'pen';
  private styles: Record<'pen' | 'highlighter', PenStyle> = { pen: { ...DEFAULT_PEN }, highlighter: { ...DEFAULT_HIGHLIGHTER } };
  selection: Id[] = [];
  private selectionPage: Id | null = null;
  private live: Live | null = null;

  constructor(private session: EditorSession, public opts: { scribbleToErase: boolean; autoShapes: boolean }, private now: () => number = () => Date.now()) {}

  get style(): PenStyle { return this.styles[this.tool === 'highlighter' ? 'highlighter' : 'pen']; }
  set style(s: PenStyle) { this.styles[this.tool === 'highlighter' ? 'highlighter' : 'pen'] = clampStyle(s); }

  /** Inking tool used for the live preview: pen unless the highlighter is active. */
  get inkTool(): 'pen' | 'highlighter' { return this.tool === 'highlighter' ? 'highlighter' : 'pen'; }

  livePoints(): Float32Array | null {
    return this.live && (this.tool === 'pen' || this.tool === 'highlighter' || this.tool === 'lasso') && !this.live.dragFrom
      ? new Float32Array(this.live.points) : null;
  }
  get liveInput(): InputKind { return this.live?.input ?? 'pen'; }
  get erasing(): ReadonlySet<Id> { return this.live?.erased ?? new Set(); }

  applyPreset(p: PenPreset): void {
    this.tool = p.tool;
    this.styles[p.tool] = clampStyle(p.style);
  }

  private visible(pageId: Id): { strokes: Stroke[]; shapes: Shape[] } {
    const s = this.session.history.state;
    return { strokes: (s.strokes[pageId] ?? []).filter((x) => !x.hidden), shapes: (s.shapes[pageId] ?? []).filter((x) => !x.hidden) };
  }

  selectionBBox(): BBox | null {
    if (!this.selection.length || !this.selectionPage) return null;
    const { strokes, shapes } = this.visible(this.selectionPage);
    return selectionBounds(strokes, shapes, this.selection);
  }

  private erase(pageId: Id, x: number, y: number): void {
    if (!this.live?.erased) return;
    const { strokes, shapes } = this.visible(pageId);
    for (const id of strokesNearPoint(x, y, ERASER_RADIUS_PT, strokes)) this.live.erased.add(id);
    for (const id of shapesNearPoint(x, y, ERASER_RADIUS_PT, shapes)) this.live.erased.add(id);
  }

  async onActions(pageId: Id, actions: RouterAction[], nowT: number): Promise<void> {
    for (const a of actions) {
      if (a.kind === 'stroke-begin') this.begin(pageId, a);
      else if (a.kind === 'stroke-point' && this.live) this.point(a);
      else if (a.kind === 'stroke-cancel') this.live = null;
      else if (a.kind === 'stroke-end' && this.live) await this.end(nowT);
    }
  }

  private begin(pageId: Id, a: Extract<RouterAction, { kind: 'stroke-begin' }>): void {
    this.live = { pageId, input: a.input, points: [a.x, a.y, a.p, a.t] };
    if (this.tool === 'eraser') {
      this.live.erased = new Set();
      this.erase(pageId, a.x, a.y);
    } else if (this.tool === 'lasso') {
      const b = this.selectionPage === pageId ? this.selectionBBox() : null;
      const inside = b && a.x >= b.minX - SELECTION_PAD_PT && a.x <= b.maxX + SELECTION_PAD_PT && a.y >= b.minY - SELECTION_PAD_PT && a.y <= b.maxY + SELECTION_PAD_PT;
      if (inside) this.live.dragFrom = [a.x, a.y];
    }
  }

  private point(a: Extract<RouterAction, { kind: 'stroke-point' }>): void {
    const live = this.live!;
    live.points.push(a.x, a.y, a.p, a.t);
    if (this.tool === 'eraser') {
      // sample along the drag so fast movements do not skip strokes
      const n = live.points.length;
      const px = live.points[n - 8], py = live.points[n - 7];
      const steps = Math.max(1, Math.ceil(Math.hypot(a.x - px, a.y - py) / ERASER_RADIUS_PT));
      for (let i = 1; i <= steps; i++) this.erase(live.pageId, px + ((a.x - px) * i) / steps, py + ((a.y - py) * i) / steps);
    }
  }

  private async end(nowT: number): Promise<void> {
    const live = this.live!;
    this.live = null;
    const pts = new Float32Array(live.points);
    const pageId = live.pageId;

    if (this.tool === 'eraser') {
      if (live.erased?.size) await this.session.run({ type: 'hideObjects', pageId, ids: [...live.erased] });
      return;
    }
    if (this.tool === 'lasso') {
      if (live.dragFrom) {
        const n = live.points.length;
        const dx = live.points[n - 4] - live.dragFrom[0];
        const dy = live.points[n - 3] - live.dragFrom[1];
        if (dx || dy) await this.session.run({ type: 'moveObjects', pageId, ids: [...this.selection], dx, dy });
        return;
      }
      const poly: [number, number][] = [];
      for (let i = 0; i < pts.length; i += 4) poly.push([pts[i], pts[i + 1]]);
      const { strokes, shapes } = this.visible(pageId);
      this.selection = poly.length >= 3 ? objectsInLasso(poly, strokes, shapes) : [];
      this.selectionPage = pageId;
      return;
    }

    if (this.tool === 'pen' && this.opts.scribbleToErase && isScribble(pts)) {
      const { strokes, shapes } = this.visible(pageId);
      const targets = scribbleTargets(pts, strokes, shapes);
      if (targets.length) {
        await this.session.run({ type: 'hideObjects', pageId, ids: targets });
        return;
      }
    }

    const stroke: Stroke = {
      id: newId(), pageId, tool: this.inkTool, style: { ...this.style }, points: pts, input: live.input,
      author: this.author(), createdAt: this.now(),
    };
    await this.session.run({ type: 'addStroke', stroke });

    // decide only at the end: a pause earlier in the stroke is just hesitation
    const held = isHolding(pts, nowT);
    if (this.tool === 'pen' && this.opts.autoShapes && held) {
      const geometry = recognizeShape(pts);
      if (geometry) {
        await this.session.run({
          type: 'addShape',
          shape: { id: newId(), pageId, geometry, style: { ...this.style }, sourceStrokeId: stroke.id, author: this.author(), createdAt: this.now() },
        });
      }
    }
  }

  private author() { return this.session.author; }

  async deleteSelection(): Promise<void> {
    if (!this.selection.length || !this.selectionPage) return;
    await this.session.run({ type: 'hideObjects', pageId: this.selectionPage, ids: [...this.selection] });
    this.clearSelection();
  }

  clearSelection(): void {
    this.selection = [];
    this.selectionPage = null;
  }

  async addPage(template: PageTemplate): Promise<void> {
    const pages = this.session.history.state.pages;
    await this.session.run({ type: 'addPage', page: blankPage(template), atIndex: pages.length });
  }
}
