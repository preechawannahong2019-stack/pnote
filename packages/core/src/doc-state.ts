import type { AuditAction } from './audit';
import type { Id, PageRef, Shape, ShapeGeometry, Stroke } from './types';

/** strokes and shapes are keyed by pageId */
export interface DocState {
  pages: PageRef[];
  strokes: Record<Id, Stroke[]>;
  shapes: Record<Id, Shape[]>;
}

export type Command =
  | { type: 'addStroke'; stroke: Stroke }
  | { type: 'hideObjects'; pageId: Id; ids: Id[] }
  | { type: 'unhideObjects'; pageId: Id; ids: Id[] }
  | { type: 'moveObjects'; pageId: Id; ids: Id[]; dx: number; dy: number }
  | { type: 'addShape'; shape: Shape }
  | { type: 'addPage'; page: PageRef; atIndex: number }
  | { type: 'removePage'; pageId: Id }
  | { type: 'reorderPage'; pageId: Id; toIndex: number };

export interface AuditRecord { action: AuditAction; objectIds: Id[] }

function setHidden<T extends { id: Id; hidden?: boolean }>(list: T[] | undefined, ids: Set<Id>, hidden: boolean): T[] {
  return (list ?? []).map((o) => (ids.has(o.id) ? { ...o, hidden } : o));
}

function moveGeometry(g: ShapeGeometry, dx: number, dy: number): ShapeGeometry {
  switch (g.kind) {
    case 'line':
    case 'arrow':
      return { ...g, x1: g.x1 + dx, y1: g.y1 + dy, x2: g.x2 + dx, y2: g.y2 + dy };
    case 'ellipse':
      return { ...g, cx: g.cx + dx, cy: g.cy + dy };
    case 'rect':
      return { ...g, x: g.x + dx, y: g.y + dy };
    case 'triangle': {
      const p = g.pts;
      return { kind: 'triangle', pts: [p[0] + dx, p[1] + dy, p[2] + dx, p[3] + dy, p[4] + dx, p[5] + dy] };
    }
  }
}

function movePoints(points: Float32Array, dx: number, dy: number): Float32Array {
  const out = new Float32Array(points);
  for (let i = 0; i < out.length; i += 4) {
    out[i] += dx;
    out[i + 1] += dy;
  }
  return out;
}

function moveIndex<T>(arr: T[], from: number, to: number): T[] {
  const out = [...arr];
  const [item] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(to, out.length)), 0, item);
  return out;
}

export function applyCommand(s: DocState, c: Command): DocState {
  switch (c.type) {
    case 'addStroke': {
      const list = s.strokes[c.stroke.pageId] ?? [];
      const exists = list.some((x) => x.id === c.stroke.id);
      const next = exists ? setHidden(list, new Set([c.stroke.id]), false) : [...list, c.stroke];
      return { ...s, strokes: { ...s.strokes, [c.stroke.pageId]: next } };
    }
    case 'hideObjects':
    case 'unhideObjects': {
      const ids = new Set(c.ids);
      const hidden = c.type === 'hideObjects';
      return {
        ...s,
        strokes: { ...s.strokes, [c.pageId]: setHidden(s.strokes[c.pageId], ids, hidden) },
        shapes: { ...s.shapes, [c.pageId]: setHidden(s.shapes[c.pageId], ids, hidden) },
      };
    }
    case 'moveObjects': {
      const ids = new Set(c.ids);
      return {
        ...s,
        strokes: {
          ...s.strokes,
          [c.pageId]: (s.strokes[c.pageId] ?? []).map((x) => (ids.has(x.id) ? { ...x, points: movePoints(x.points, c.dx, c.dy) } : x)),
        },
        shapes: {
          ...s.shapes,
          [c.pageId]: (s.shapes[c.pageId] ?? []).map((x) => (ids.has(x.id) ? { ...x, geometry: moveGeometry(x.geometry, c.dx, c.dy) } : x)),
        },
      };
    }
    case 'addShape': {
      const pid = c.shape.pageId;
      const list = s.shapes[pid] ?? [];
      const exists = list.some((x) => x.id === c.shape.id);
      const shapes = exists ? setHidden(list, new Set([c.shape.id]), false) : [...list, c.shape];
      return {
        ...s,
        shapes: { ...s.shapes, [pid]: shapes },
        strokes: { ...s.strokes, [pid]: setHidden(s.strokes[pid], new Set([c.shape.sourceStrokeId]), true) },
      };
    }
    case 'addPage': {
      const pages = [...s.pages];
      pages.splice(Math.max(0, Math.min(c.atIndex, pages.length)), 0, c.page);
      return {
        pages,
        strokes: { ...s.strokes, [c.page.id]: s.strokes[c.page.id] ?? [] },
        shapes: { ...s.shapes, [c.page.id]: s.shapes[c.page.id] ?? [] },
      };
    }
    case 'removePage':
      // strokes/shapes of the page are kept so undo can restore them
      return { ...s, pages: s.pages.filter((p) => p.id !== c.pageId) };
    case 'reorderPage': {
      const from = s.pages.findIndex((p) => p.id === c.pageId);
      if (from < 0) return s;
      return { ...s, pages: moveIndex(s.pages, from, c.toIndex) };
    }
  }
}

function splitIds(s: DocState, pageId: Id, ids: Id[]): { strokes: Id[]; shapes: Id[] } {
  const shapeIds = new Set((s.shapes[pageId] ?? []).map((x) => x.id));
  return { strokes: ids.filter((i) => !shapeIds.has(i)), shapes: ids.filter((i) => shapeIds.has(i)) };
}

/** Audit records describing what `c` does when applied to `before`. */
export function auditRecordsFor(before: DocState, c: Command): AuditRecord[] {
  switch (c.type) {
    case 'addStroke': {
      const exists = (before.strokes[c.stroke.pageId] ?? []).some((x) => x.id === c.stroke.id);
      return [{ action: exists ? 'stroke.unhide' : 'stroke.add', objectIds: [c.stroke.id] }];
    }
    case 'hideObjects':
    case 'unhideObjects': {
      const { strokes, shapes } = splitIds(before, c.pageId, c.ids);
      const verb = c.type === 'hideObjects' ? 'hide' : 'unhide';
      const out: AuditRecord[] = [];
      if (strokes.length) out.push({ action: `stroke.${verb}`, objectIds: strokes });
      if (shapes.length) out.push({ action: `shape.${verb}`, objectIds: shapes });
      return out;
    }
    case 'moveObjects':
      return [{ action: 'objects.move', objectIds: [...c.ids] }];
    case 'addShape': {
      const exists = (before.shapes[c.shape.pageId] ?? []).some((x) => x.id === c.shape.id);
      return [
        { action: exists ? 'shape.unhide' : 'shape.add', objectIds: [c.shape.id] },
        { action: 'stroke.hide', objectIds: [c.shape.sourceStrokeId] },
      ];
    }
    case 'addPage':
      return [{ action: 'page.add', objectIds: [c.page.id] }];
    case 'removePage':
      return [{ action: 'page.remove', objectIds: [c.pageId] }];
    case 'reorderPage':
      return [{ action: 'page.reorder', objectIds: [c.pageId] }];
  }
}

/** Commands that undo `c`, computed against the state before `c` was applied. */
export function invertCommand(before: DocState, c: Command): Command[] {
  switch (c.type) {
    case 'addStroke':
      return [{ type: 'hideObjects', pageId: c.stroke.pageId, ids: [c.stroke.id] }];
    case 'hideObjects':
    case 'unhideObjects': {
      const target = c.type === 'hideObjects';
      const all = [...(before.strokes[c.pageId] ?? []), ...(before.shapes[c.pageId] ?? [])];
      const changed = all.filter((o) => c.ids.includes(o.id) && Boolean(o.hidden) !== target).map((o) => o.id);
      if (!changed.length) return [];
      return [{ type: target ? 'unhideObjects' : 'hideObjects', pageId: c.pageId, ids: changed }];
    }
    case 'moveObjects':
      return [{ ...c, dx: -c.dx, dy: -c.dy }];
    case 'addShape': {
      const pid = c.shape.pageId;
      const out: Command[] = [{ type: 'hideObjects', pageId: pid, ids: [c.shape.id] }];
      const src = (before.strokes[pid] ?? []).find((x) => x.id === c.shape.sourceStrokeId);
      if (src && !src.hidden) out.push({ type: 'unhideObjects', pageId: pid, ids: [src.id] });
      return out;
    }
    case 'addPage':
      return [{ type: 'removePage', pageId: c.page.id }];
    case 'removePage': {
      const idx = before.pages.findIndex((p) => p.id === c.pageId);
      return idx < 0 ? [] : [{ type: 'addPage', page: before.pages[idx], atIndex: idx }];
    }
    case 'reorderPage': {
      const idx = before.pages.findIndex((p) => p.id === c.pageId);
      return idx < 0 ? [] : [{ type: 'reorderPage', pageId: c.pageId, toIndex: idx }];
    }
  }
}
