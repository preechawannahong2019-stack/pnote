import * as outline from '../src/outline';
import { PageRenderer, ptToScreen, screenToPt, type Viewport } from '../src/renderer';
import { DEFAULT_HIGHLIGHTER } from '../src/outline';
import { hline, rect } from './helpers';

vi.mock('../src/outline', async (orig) => {
  const mod = await orig<typeof import('../src/outline')>();
  return { ...mod, strokeOutline: vi.fn(mod.strokeOutline) };
});

const page = { id: 'pg', source: { type: 'blank' as const, template: 'lined' as const }, widthPt: 595.28, heightPt: 841.89 };

function canvases() {
  const base = document.createElement('canvas');
  const live = document.createElement('canvas');
  base.width = live.width = 600;
  base.height = live.height = 850;
  return { base, live };
}

type Ev = { type: string; props: Record<string, unknown> };
const events = (c: HTMLCanvasElement) => (c.getContext('2d') as unknown as { __getEvents(): Ev[] }).__getEvents();
const clear = (c: HTMLCanvasElement) => (c.getContext('2d') as unknown as { __clearEvents(): void }).__clearEvents();

describe('viewport math', () => {
  it.each<Viewport>([
    { scale: 1, offsetX: 0, offsetY: 0, dpr: 1 },
    { scale: 2.5, offsetX: -40, offsetY: 13, dpr: 2 },
  ])('screenToPt inverts ptToScreen %#', (v) => {
    const [sx, sy] = ptToScreen(v, 123.4, 56.7);
    const [x, y] = screenToPt(v, sx, sy);
    expect(x).toBeCloseTo(123.4, 6);
    expect(y).toBeCloseTo(56.7, 6);
  });
});

describe('PageRenderer', () => {
  beforeEach(() => { vi.mocked(outline.strokeOutline).mockClear(); });

  it('draws highlighters (multiply) before pens and skips hidden strokes', () => {
    const { base, live } = canvases();
    const r = new PageRenderer(base, live);
    r.setViewport({ scale: 1, offsetX: 0, offsetY: 0, dpr: 1 });
    const pen = hline('pen', 0, 100, 10);
    const hi = { ...hline('hi', 0, 100, 20), tool: 'highlighter' as const, style: DEFAULT_HIGHLIGHTER };
    const hidden = { ...hline('h', 0, 100, 30), hidden: true };
    clear(base);
    r.renderPage(page, [pen, hi, hidden], []);
    const ev = events(base);
    const fills: string[] = [];
    let mode = 'source-over';
    for (const e of ev) {
      if (e.type === 'globalCompositeOperation') mode = String(e.props.value);
      if (e.type === 'fill') fills.push(mode);
    }
    expect(fills).toEqual(['multiply', 'source-over']);
  });

  it('caches outlines and recomputes only invalidated strokes', () => {
    const { base, live } = canvases();
    const r = new PageRenderer(base, live);
    r.setViewport({ scale: 1, offsetX: 0, offsetY: 0, dpr: 1 });
    const a = hline('a', 0, 100, 10);
    const b = hline('b', 0, 100, 40);
    r.renderPage(page, [a, b], []);
    expect(outline.strokeOutline).toHaveBeenCalledTimes(2);
    r.renderPage(page, [a, b], []);
    expect(outline.strokeOutline).toHaveBeenCalledTimes(2);
    r.invalidate(['a']);
    r.renderPage(page, [a, b], []);
    expect(outline.strokeOutline).toHaveBeenCalledTimes(3);
  });

  it('recomputes a stroke whose points changed (moved)', () => {
    const { base, live } = canvases();
    const r = new PageRenderer(base, live);
    const a = hline('a', 0, 100, 10);
    r.renderPage(page, [a], []);
    r.renderPage(page, [{ ...a, points: new Float32Array(a.points) }], []);
    expect(outline.strokeOutline).toHaveBeenCalledTimes(2);
  });

  it('draws shapes as stroked paths', () => {
    const { base, live } = canvases();
    const r = new PageRenderer(base, live);
    clear(base);
    r.renderPage(page, [], [rect('r', 0, 0, 10, 10), { ...rect('h', 0, 0, 5, 5), hidden: true }]);
    expect(events(base).filter((e) => e.type === 'stroke').length).toBeGreaterThan(0);
  });

  it('drawLive touches only the live canvas', () => {
    const { base, live } = canvases();
    const r = new PageRenderer(base, live);
    clear(base);
    clear(live);
    r.drawLive(hline('x', 0, 50, 5).points, 'pen', outline.DEFAULT_PEN, 'pen');
    expect(events(base)).toEqual([]);
    expect(events(live).some((e) => e.type === 'fill')).toBe(true);
    r.clearLive();
    expect(events(live).some((e) => e.type === 'clearRect')).toBe(true);
  });
});

describe('PageRenderer stage 2', () => {
  const tb = (id: string, text: string, extra = {}) => ({ id, pageId: 'pg', x: 10, y: 10, w: 80, h: 20, text, font: 'sarabun' as const, sizePt: 12, color: '#000', bold: false, author: { profileId: 'p', name: 'A' }, createdAt: 1, updatedAt: 1, ...extra });

  it('draws the background before strokes', () => {
    const { base, live } = canvases();
    const r = new PageRenderer(base, live);
    const bg = document.createElement('canvas');
    clear(base);
    r.renderPage(page, [hline('a', 0, 10, 10)], [], [], bg);
    const types = events(base).map((e) => e.type);
    expect(types.indexOf('drawImage')).toBeGreaterThan(-1);
    expect(types.indexOf('drawImage')).toBeLessThan(types.lastIndexOf('fill'));
  });

  it('draws text boxes with Sarabun, wraps long text, skips hidden', () => {
    const { base, live } = canvases();
    const r = new PageRenderer(base, live);
    clear(base);
    r.renderPage(page, [], [], [tb('t1', 'สั้น'), tb('t2', 'ข้อความยาวมาก '.repeat(10)), tb('t3', 'ซ่อน', { hidden: true })]);
    const ev = events(base);
    const fonts = ev.filter((e) => e.type === 'font').map((e) => String(e.props.value));
    expect(fonts.some((f) => f.includes('Sarabun'))).toBe(true);
    const texts = ev.filter((e) => e.type === 'fillText').map((e) => String(e.props.text));
    expect(texts).toContain('สั้น');
    expect(texts.filter((t) => t.includes('ข้อความ')).length).toBeGreaterThan(1);
    expect(texts.join('')).not.toContain('ซ่อน');
  });
});
