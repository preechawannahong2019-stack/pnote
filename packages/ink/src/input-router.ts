import type { InputKind } from '@pnote/core/types';

export type InputMode = 'pen' | 'finger';

export interface PointerSample {
  type: 'down' | 'move' | 'up' | 'cancel';
  pointerId: number;
  pointerType: InputKind;
  x: number;
  y: number;
  pressure: number;
  t: number;
}

export type RouterAction =
  | { kind: 'stroke-begin'; pointerId: number; input: InputKind; x: number; y: number; p: number; t: number }
  | { kind: 'stroke-point'; pointerId: number; x: number; y: number; p: number; t: number }
  | { kind: 'stroke-end'; pointerId: number }
  | { kind: 'stroke-cancel'; pointerId: number }
  | { kind: 'pan'; dx: number; dy: number }
  | { kind: 'zoom'; scale: number; cx: number; cy: number }
  | { kind: 'three-finger-tap' };

export const TAP_MAX_MS = 300;
export const TAP_MAX_MOVE_PX = 10;

interface TouchPt { x: number; y: number; sx: number; sy: number }

export class InputRouter {
  private stroke: { pointerId: number; input: InputKind } | null = null;
  /** touches that are not drawing */
  private touches = new Map<number, TouchPt>();
  private tap: { start: number; maxMove: number; peak: number } | null = null;
  /** touch ids that were used while a pen stroke was active (palm) — ignored until lifted */
  private palms = new Set<number>();

  constructor(private mode: InputMode) {}

  setMode(m: InputMode): RouterAction[] {
    this.mode = m;
    if (m === 'pen' && this.stroke?.input === 'touch') {
      const id = this.stroke.pointerId;
      this.stroke = null;
      this.palms.add(id);
      return [{ kind: 'stroke-cancel', pointerId: id }];
    }
    return [];
  }

  private canDraw(type: InputKind): boolean {
    if (type === 'pen' || type === 'mouse') return true;
    return this.mode === 'finger';
  }

  handle(s: PointerSample): RouterAction[] {
    if (this.stroke && s.pointerId === this.stroke.pointerId) return this.handleStroke(s);
    if (s.pointerType !== 'touch') {
      if (s.type === 'down' && !this.stroke) return this.beginStroke(s);
      return [];
    }
    return this.handleTouch(s);
  }

  private beginStroke(s: PointerSample): RouterAction[] {
    if (s.pointerType !== 'touch') {
      // touches already on the screen when a pen/mouse stroke starts are palms
      for (const id of this.touches.keys()) this.palms.add(id);
      this.touches.clear();
      this.tap = null;
    }
    this.stroke = { pointerId: s.pointerId, input: s.pointerType };
    return [{ kind: 'stroke-begin', pointerId: s.pointerId, input: s.pointerType, x: s.x, y: s.y, p: s.pressure, t: s.t }];
  }

  private handleStroke(s: PointerSample): RouterAction[] {
    const id = s.pointerId;
    switch (s.type) {
      case 'move':
        if (this.stroke?.input === 'touch') this.lastStrokePt = { x: s.x, y: s.y };
        return [{ kind: 'stroke-point', pointerId: id, x: s.x, y: s.y, p: s.pressure, t: s.t }];
      case 'up': this.stroke = null; return [{ kind: 'stroke-end', pointerId: id }];
      case 'cancel': this.stroke = null; return [{ kind: 'stroke-cancel', pointerId: id }];
      default: return [];
    }
  }

  private handleTouch(s: PointerSample): RouterAction[] {
    const id = s.pointerId;
    if (this.palms.has(id)) {
      if (s.type === 'up' || s.type === 'cancel') this.palms.delete(id);
      return [];
    }
    // palm rejection: touches while a pen/mouse stroke is active are ignored
    if (this.stroke && this.stroke.input !== 'touch') {
      if (s.type === 'down') this.palms.add(id);
      else if (s.type === 'up' || s.type === 'cancel') { this.palms.delete(id); this.touches.delete(id); }
      return [];
    }
    if (s.type === 'down') return this.touchDown(s);
    if (s.type === 'move') return this.touchMove(s);
    return this.touchUp(s);
  }

  private touchDown(s: PointerSample): RouterAction[] {
    const out: RouterAction[] = [];
    if (this.stroke?.input === 'touch') {
      // a second finger: this was not a stroke after all
      const first = this.stroke.pointerId;
      out.push({ kind: 'stroke-cancel', pointerId: first });
      this.stroke = null;
      const last = this.lastStrokePt ?? { x: s.x, y: s.y };
      this.touches.set(first, { x: last.x, y: last.y, sx: last.x, sy: last.y });
      this.lastStrokePt = null;
    } else if (this.touches.size === 0 && this.canDraw('touch')) {
      this.tap = { start: s.t, maxMove: 0, peak: 1 };
      this.lastStrokePt = { x: s.x, y: s.y };
      return this.beginStroke(s);
    }
    this.touches.set(s.pointerId, { x: s.x, y: s.y, sx: s.x, sy: s.y });
    if (!this.tap) this.tap = { start: s.t, maxMove: 0, peak: 0 };
    this.tap.peak = Math.max(this.tap.peak, this.touches.size);
    return out;
  }

  private lastStrokePt: { x: number; y: number } | null = null;

  private touchMove(s: PointerSample): RouterAction[] {
    const pt = this.touches.get(s.pointerId);
    if (!pt) return [];
    if (this.tap) this.tap.maxMove = Math.max(this.tap.maxMove, Math.hypot(s.x - pt.sx, s.y - pt.sy));
    const others = [...this.touches.entries()].filter(([k]) => k !== s.pointerId).map(([, v]) => v);
    const out: RouterAction[] = [];
    if (others.length === 0) {
      out.push({ kind: 'pan', dx: s.x - pt.x, dy: s.y - pt.y });
    } else if (others.length === 1) {
      const o = others[0];
      const before = Math.hypot(pt.x - o.x, pt.y - o.y);
      const after = Math.hypot(s.x - o.x, s.y - o.y);
      const cx0 = (pt.x + o.x) / 2, cy0 = (pt.y + o.y) / 2;
      const cx = (s.x + o.x) / 2, cy = (s.y + o.y) / 2;
      if (before > 0) out.push({ kind: 'zoom', scale: after / before, cx, cy });
      if (cx !== cx0 || cy !== cy0) out.push({ kind: 'pan', dx: cx - cx0, dy: cy - cy0 });
    }
    pt.x = s.x;
    pt.y = s.y;
    return out;
  }

  private touchUp(s: PointerSample): RouterAction[] {
    if (!this.touches.delete(s.pointerId)) return [];
    if (this.touches.size > 0 || !this.tap) return [];
    const tap = this.tap;
    this.tap = null;
    if (tap.peak === 3 && s.t - tap.start <= TAP_MAX_MS && tap.maxMove < TAP_MAX_MOVE_PX) return [{ kind: 'three-finger-tap' }];
    return [];
  }
}
