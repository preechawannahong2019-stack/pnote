import type { RouterAction } from '@pnote/ink/input-router';
import { MemoryAdapter } from '@pnote/storage/adapter';
import { generateDataKey } from '@pnote/storage/crypto';
import { EncryptedStore } from '@pnote/storage/encrypted-store';
import { Library } from '@pnote/storage/library';
import { EditorController } from '../src/lib/editor-controller';
import { EditorSession } from '../src/lib/session';

const author = { profileId: 'p1', name: 'A' };

async function setup(opts = { scribbleToErase: true, autoShapes: true }) {
  const lib = new Library(new EncryptedStore(new MemoryAdapter(), await generateDataKey(), 'p1'), author);
  const meta = await lib.createNotebook('x', null);
  const session = await EditorSession.open(lib, author, meta.id, { lock: async () => ({ readOnly: false, release: () => {} }) });
  const ctrl = new EditorController(session, opts);
  const pageId = meta.pages[0].id;
  const state = () => session.history.state;
  const visible = () => state().strokes[pageId].filter((s) => !s.hidden);
  return { ctrl, session, pageId, state, visible };
}

let t = 0;
function gesture(pts: [number, number][], opts: { input?: 'pen' | 'touch'; dt?: number } = {}): RouterAction[] {
  const dt = opts.dt ?? 8;
  const out: RouterAction[] = [];
  pts.forEach(([x, y], i) => {
    t += dt;
    out.push(i === 0
      ? { kind: 'stroke-begin', pointerId: 1, input: opts.input ?? 'pen', x, y, p: 0.5, t }
      : { kind: 'stroke-point', pointerId: 1, x, y, p: 0.5, t });
  });
  out.push({ kind: 'stroke-end', pointerId: 1 });
  return out;
}
const line = (x0: number, x1: number, y: number, n = 20): [number, number][] => Array.from({ length: n }, (_, i) => [x0 + ((x1 - x0) * i) / (n - 1), y]);
function zigzag(x0: number, x1: number, y: number, legs: number): [number, number][] {
  const out: [number, number][] = [];
  for (let l = 0; l < legs; l++) {
    const [a, b] = l % 2 ? [x1, x0] : [x0, x1];
    for (let i = 0; i <= 10; i++) out.push([a + ((b - a) * i) / 10, y + (l % 2 ? 6 : -6) * (i / 10)]);
  }
  return out;
}
function circleWithHold(): RouterAction[] {
  const pts: [number, number][] = Array.from({ length: 60 }, (_, i) => {
    const a = (i / 59) * Math.PI * 2;
    return [200 + 50 * Math.cos(a), 200 + 50 * Math.sin(a)];
  });
  const acts = gesture(pts);
  acts.pop();
  const last = pts[pts.length - 1];
  for (let ms = 8; ms <= 520; ms += 8) { t += 8; acts.push({ kind: 'stroke-point', pointerId: 1, x: last[0], y: last[1], p: 0.5, t }); }
  acts.push({ kind: 'stroke-end', pointerId: 1 });
  return acts;
}

describe('EditorController', () => {
  it('adds one visible stroke for a pen gesture', async () => {
    const { ctrl, pageId, visible } = await setup();
    await ctrl.onActions(pageId, gesture(line(0, 100, 50)), t);
    expect(visible()).toHaveLength(1);
    expect(visible()[0].author).toEqual(author);
  });

  it('scribble over a stroke hides it and adds nothing', async () => {
    const { ctrl, pageId, state, visible } = await setup();
    await ctrl.onActions(pageId, gesture(line(0, 40, 50)), t);
    await ctrl.onActions(pageId, gesture(zigzag(0, 40, 50, 5)), t);
    expect(visible()).toHaveLength(0);
    expect(state().strokes[pageId]).toHaveLength(1);
  });

  it('with scribble off, a zig-zag is a normal stroke', async () => {
    const { ctrl, pageId, visible } = await setup({ scribbleToErase: false, autoShapes: true });
    await ctrl.onActions(pageId, gesture(line(0, 40, 50)), t);
    await ctrl.onActions(pageId, gesture(zigzag(0, 40, 50, 5)), t);
    expect(visible()).toHaveLength(2);
  });

  it('a zig-zag over empty paper is kept as ink', async () => {
    const { ctrl, pageId, visible } = await setup();
    await ctrl.onActions(pageId, gesture(zigzag(300, 340, 300, 5)), t);
    expect(visible()).toHaveLength(1);
  });

  it('a held circle becomes an ellipse and undo restores the hand stroke', async () => {
    const { ctrl, session, pageId, state, visible } = await setup();
    await ctrl.onActions(pageId, circleWithHold(), t);
    expect(visible()).toHaveLength(0);
    expect(state().shapes[pageId].map((s) => s.geometry.kind)).toEqual(['ellipse']);
    await session.undo();
    expect(visible()).toHaveLength(1);
    expect(state().shapes[pageId][0].hidden).toBe(true);
  });

  it('auto shapes off keeps the hand stroke', async () => {
    const { ctrl, pageId, state, visible } = await setup({ scribbleToErase: true, autoShapes: false });
    await ctrl.onActions(pageId, circleWithHold(), t);
    expect(visible()).toHaveLength(1);
    expect(state().shapes[pageId]).toHaveLength(0);
  });

  it('eraser drag hides two strokes in one undo step', async () => {
    const { ctrl, session, pageId, visible } = await setup();
    await ctrl.onActions(pageId, gesture(line(0, 100, 50)), t);
    await ctrl.onActions(pageId, gesture(line(0, 100, 80)), t);
    ctrl.tool = 'eraser';
    await ctrl.onActions(pageId, gesture([[50, 40], [50, 60], [50, 80], [50, 90]]), t);
    expect(visible()).toHaveLength(0);
    await session.undo();
    expect(visible()).toHaveLength(2);
  });

  it('lasso selects and drag moves the selection by 10 pt', async () => {
    const { ctrl, pageId, state } = await setup();
    await ctrl.onActions(pageId, gesture(line(20, 80, 50)), t);
    const before = Array.from(state().strokes[pageId][0].points);
    ctrl.tool = 'lasso';
    await ctrl.onActions(pageId, gesture([[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]]), t);
    expect(ctrl.selection).toEqual([state().strokes[pageId][0].id]);
    await ctrl.onActions(pageId, gesture([[50, 50], [55, 55], [60, 60]]), t);
    const after = Array.from(state().strokes[pageId][0].points);
    expect(after[0]).toBeCloseTo(before[0] + 10);
    expect(after[1]).toBeCloseTo(before[1] + 10);
  });

  it('deleteSelection hides the selected objects', async () => {
    const { ctrl, pageId, visible } = await setup();
    await ctrl.onActions(pageId, gesture(line(20, 80, 50)), t);
    ctrl.tool = 'lasso';
    await ctrl.onActions(pageId, gesture([[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]]), t);
    await ctrl.deleteSelection();
    expect(visible()).toHaveLength(0);
    expect(ctrl.selection).toEqual([]);
  });

  it('applyPreset changes tool and style', async () => {
    const { ctrl } = await setup();
    const style = { color: '#ff0000', width: 7, opacity: 0.3, pressureCurve: 'off' as const, taperStart: 0, taperEnd: 0, smoothing: 0.2 };
    ctrl.applyPreset({ id: 'x', name: 'แดง', tool: 'highlighter', style });
    expect(ctrl.tool).toBe('highlighter');
    expect(ctrl.style).toEqual(style);
  });

  it('cancelled stroke adds nothing', async () => {
    const { ctrl, pageId, visible } = await setup();
    const acts = gesture(line(0, 100, 50));
    acts[acts.length - 1] = { kind: 'stroke-cancel', pointerId: 1 };
    await ctrl.onActions(pageId, acts, t);
    expect(visible()).toHaveLength(0);
    expect(ctrl.livePoints()).toBeNull();
  });

  it('addPage appends a page', async () => {
    const { ctrl, state } = await setup();
    await ctrl.addPage('grid');
    expect(state().pages).toHaveLength(2);
    expect(state().pages[1].source).toEqual({ type: 'blank', template: 'grid' });
  });
});
