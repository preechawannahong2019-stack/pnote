import { applyCommand, History } from '../src/history';
import { emptyState, page, rectShape, stroke } from './fixtures';

describe('History', () => {
  it('adds a visible stroke', () => {
    const h = new History(emptyState());
    const rec = h.apply({ type: 'addStroke', stroke: stroke('s1') });
    expect(h.state.strokes.pg1).toHaveLength(1);
    expect(h.state.strokes.pg1[0].hidden).toBeFalsy();
    expect(rec).toEqual([{ action: 'stroke.add', objectIds: ['s1'] }]);
  });

  it('undo hides the stroke but keeps it; redo unhides', () => {
    const h = new History(emptyState());
    h.apply({ type: 'addStroke', stroke: stroke('s1') });
    expect(h.undo()).toEqual([{ action: 'stroke.hide', objectIds: ['s1'] }]);
    expect(h.state.strokes.pg1).toHaveLength(1);
    expect(h.state.strokes.pg1[0].hidden).toBe(true);
    expect(h.redo()).toEqual([{ action: 'stroke.unhide', objectIds: ['s1'] }]);
    expect(h.state.strokes.pg1[0].hidden).toBeFalsy();
  });

  it('undo returns null when nothing to undo', () => {
    const h = new History(emptyState());
    expect(h.undo()).toBeNull();
    expect(h.redo()).toBeNull();
  });

  it('addShape hides its source stroke and undo restores it', () => {
    const h = new History(emptyState());
    h.apply({ type: 'addStroke', stroke: stroke('s1') });
    const rec = h.apply({ type: 'addShape', shape: rectShape('sh1', 's1') });
    expect(rec).toEqual([{ action: 'shape.add', objectIds: ['sh1'] }, { action: 'stroke.hide', objectIds: ['s1'] }]);
    expect(h.state.strokes.pg1[0].hidden).toBe(true);
    expect(h.state.shapes.pg1).toHaveLength(1);
    h.undo();
    expect(h.state.strokes.pg1[0].hidden).toBeFalsy();
    expect(h.state.shapes.pg1[0].hidden).toBe(true);
  });

  it('hideObjects hides strokes and shapes; undo unhides', () => {
    const h = new History(emptyState());
    h.apply({ type: 'addStroke', stroke: stroke('s1') });
    h.apply({ type: 'addStroke', stroke: stroke('s2') });
    h.apply({ type: 'hideObjects', pageId: 'pg1', ids: ['s1', 's2'] });
    expect(h.state.strokes.pg1.every((s) => s.hidden)).toBe(true);
    h.undo();
    expect(h.state.strokes.pg1.some((s) => s.hidden)).toBe(false);
  });

  it('moveObjects shifts points and shape geometry; undo moves back', () => {
    const h = new History(emptyState());
    h.apply({ type: 'addStroke', stroke: stroke('s1') });
    h.apply({ type: 'addStroke', stroke: stroke('s2') });
    h.apply({ type: 'addShape', shape: rectShape('sh1', 's2') });
    h.apply({ type: 'moveObjects', pageId: 'pg1', ids: ['s1', 'sh1'], dx: 5, dy: -3 });
    expect(Array.from(h.state.strokes.pg1[0].points)).toEqual([5, -3, 0.5, 0, 15, 7, 0.5, 10]);
    expect(h.state.shapes.pg1[0].geometry).toEqual({ kind: 'rect', x: 5, y: -3, w: 10, h: 10 });
    h.undo();
    expect(Array.from(h.state.strokes.pg1[0].points)).toEqual([0, 0, 0.5, 0, 10, 10, 0.5, 10]);
  });

  it('page add, reorder and remove change order; undo restores', () => {
    const h = new History(emptyState('a', 'b'));
    h.apply({ type: 'addPage', page: page('c'), atIndex: 1 });
    expect(h.state.pages.map((p) => p.id)).toEqual(['a', 'c', 'b']);
    expect(h.state.strokes.c).toEqual([]);
    h.apply({ type: 'reorderPage', pageId: 'a', toIndex: 2 });
    expect(h.state.pages.map((p) => p.id)).toEqual(['c', 'b', 'a']);
    h.apply({ type: 'removePage', pageId: 'b' });
    expect(h.state.pages.map((p) => p.id)).toEqual(['c', 'a']);
    h.undo();
    expect(h.state.pages.map((p) => p.id)).toEqual(['c', 'b', 'a']);
    h.undo();
    expect(h.state.pages.map((p) => p.id)).toEqual(['a', 'c', 'b']);
    h.undo();
    expect(h.state.pages.map((p) => p.id)).toEqual(['a', 'b']);
  });

  it('removed page keeps its strokes so undo brings them back', () => {
    const h = new History(emptyState('a', 'b'));
    h.apply({ type: 'addStroke', stroke: stroke('s1', 'b') });
    h.apply({ type: 'removePage', pageId: 'b' });
    h.undo();
    expect(h.state.strokes.b).toHaveLength(1);
  });

  it('apply after undo clears redo', () => {
    const h = new History(emptyState());
    h.apply({ type: 'addStroke', stroke: stroke('s1') });
    h.undo();
    expect(h.canRedo).toBe(true);
    h.apply({ type: 'addStroke', stroke: stroke('s2') });
    expect(h.canRedo).toBe(false);
    expect(h.canUndo).toBe(true);
  });

  it('notifies onChange', () => {
    const h = new History(emptyState());
    const seen: number[] = [];
    const off = h.onChange((s) => seen.push(s.strokes.pg1.length));
    h.apply({ type: 'addStroke', stroke: stroke('s1') });
    off();
    h.apply({ type: 'addStroke', stroke: stroke('s2') });
    expect(seen).toEqual([1]);
  });
});

describe('applyCommand', () => {
  it('does not mutate its input', () => {
    const s0 = emptyState();
    const withStroke = applyCommand(s0, { type: 'addStroke', stroke: stroke('s1') });
    const snapshot = structuredClone(withStroke);
    applyCommand(withStroke, { type: 'moveObjects', pageId: 'pg1', ids: ['s1'], dx: 1, dy: 1 });
    applyCommand(withStroke, { type: 'hideObjects', pageId: 'pg1', ids: ['s1'] });
    expect(withStroke).toEqual(snapshot);
    expect(s0.strokes.pg1).toEqual([]);
  });
});
