import { InputRouter, type PointerSample, type RouterAction } from '../src/input-router';

let t = 0;
function s(type: PointerSample['type'], pointerId: number, pointerType: PointerSample['pointerType'], x: number, y: number, dt = 8): PointerSample {
  t += dt;
  return { type, pointerId, pointerType, x, y, pressure: 0.5, t };
}
const kinds = (a: RouterAction[]) => a.map((x) => x.kind);
function feed(r: InputRouter, samples: PointerSample[]): RouterAction[] {
  return samples.flatMap((x) => r.handle(x));
}

describe('InputRouter pen mode', () => {
  it('draws with the pen', () => {
    const r = new InputRouter('pen');
    expect(kinds(feed(r, [s('down', 1, 'pen', 0, 0), s('move', 1, 'pen', 5, 5), s('up', 1, 'pen', 5, 5)]))).toEqual(['stroke-begin', 'stroke-point', 'stroke-end']);
  });

  it('draws with the mouse', () => {
    const r = new InputRouter('pen');
    expect(kinds(feed(r, [s('down', 1, 'mouse', 0, 0), s('up', 1, 'mouse', 0, 0)]))).toEqual(['stroke-begin', 'stroke-end']);
  });

  it('ignores a resting palm while the pen draws', () => {
    const r = new InputRouter('pen');
    const out = feed(r, [
      s('down', 1, 'pen', 0, 0),
      s('down', 2, 'touch', 100, 100),
      s('move', 2, 'touch', 110, 105),
      s('move', 1, 'pen', 5, 5),
      s('up', 2, 'touch', 110, 105),
      s('up', 1, 'pen', 5, 5),
    ]);
    expect(kinds(out)).toEqual(['stroke-begin', 'stroke-point', 'stroke-end']);
  });

  it('pans with one finger and never draws with touch', () => {
    const r = new InputRouter('pen');
    const out = feed(r, [s('down', 2, 'touch', 0, 0), s('move', 2, 'touch', 10, 4), s('up', 2, 'touch', 10, 4)]);
    expect(out).toEqual([{ kind: 'pan', dx: 10, dy: 4 }]);
  });

  it('zooms in when two fingers move apart', () => {
    const r = new InputRouter('pen');
    const out = feed(r, [s('down', 2, 'touch', 100, 100), s('down', 3, 'touch', 200, 100), s('move', 3, 'touch', 300, 100)]);
    const zoom = out.find((a) => a.kind === 'zoom');
    expect(zoom).toBeDefined();
    if (zoom?.kind === 'zoom') expect(zoom.scale).toBeCloseTo(2, 5);
  });
});

describe('InputRouter finger mode', () => {
  it('draws with one finger', () => {
    const r = new InputRouter('finger');
    expect(kinds(feed(r, [s('down', 2, 'touch', 0, 0), s('move', 2, 'touch', 3, 3), s('up', 2, 'touch', 3, 3)]))).toEqual(['stroke-begin', 'stroke-point', 'stroke-end']);
  });

  it('cancels the stroke when a second finger lands and switches to gesture', () => {
    const r = new InputRouter('finger');
    const out = feed(r, [
      s('down', 2, 'touch', 100, 100),
      s('move', 2, 'touch', 102, 100),
      s('down', 3, 'touch', 200, 100),
      s('move', 3, 'touch', 260, 100),
      s('up', 2, 'touch', 102, 100),
      s('up', 3, 'touch', 260, 100),
    ]);
    const k = kinds(out);
    expect(k.slice(0, 3)).toEqual(['stroke-begin', 'stroke-point', 'stroke-cancel']);
    expect(k).not.toContain('stroke-end');
    expect(k).toContain('zoom');
  });

  it('still draws with the pen', () => {
    const r = new InputRouter('finger');
    expect(kinds(feed(r, [s('down', 1, 'pen', 0, 0), s('up', 1, 'pen', 0, 0)]))).toEqual(['stroke-begin', 'stroke-end']);
  });
});

describe('three-finger tap', () => {
  function tap(r: InputRouter, holdMs: number) {
    return feed(r, [
      s('down', 2, 'touch', 0, 0),
      s('down', 3, 'touch', 50, 0),
      s('down', 4, 'touch', 100, 0),
      s('up', 2, 'touch', 0, 0, holdMs),
      s('up', 3, 'touch', 50, 0, 1),
      s('up', 4, 'touch', 100, 0, 1),
    ]);
  }
  it('fires on a quick tap', () => {
    expect(kinds(tap(new InputRouter('pen'), 100)).filter((k) => k === 'three-finger-tap')).toHaveLength(1);
  });
  it('does not fire on a slow tap', () => {
    expect(kinds(tap(new InputRouter('pen'), 400))).not.toContain('three-finger-tap');
  });
  it('works in finger mode without leaving a stroke', () => {
    const k = kinds(tap(new InputRouter('finger'), 100));
    expect(k).toContain('three-finger-tap');
    expect(k).not.toContain('stroke-end');
  });
});

it('cancel sample cancels the active stroke', () => {
  const r = new InputRouter('pen');
  expect(kinds(feed(r, [s('down', 1, 'pen', 0, 0), s('cancel', 1, 'pen', 0, 0)]))).toEqual(['stroke-begin', 'stroke-cancel']);
});

it('setMode cancels an active touch stroke when switching to pen mode', () => {
  const r = new InputRouter('finger');
  r.handle(s('down', 2, 'touch', 0, 0));
  r.setMode('pen');
  expect(kinds(r.handle(s('move', 2, 'touch', 5, 5)))).not.toContain('stroke-point');
});

describe('review fixes: palm lifted during a pen stroke', () => {
  it('a palm lifted before pen-up leaves no ghost touch (pan stays a pan)', () => {
    const r = new InputRouter('pen');
    feed(r, [s('down', 2, 'touch', 100, 100), s('down', 1, 'pen', 0, 0), s('up', 2, 'touch', 100, 100), s('up', 1, 'pen', 0, 0)]);
    const out = feed(r, [s('down', 3, 'touch', 0, 0), s('move', 3, 'touch', 10, 0)]);
    expect(out).toEqual([{ kind: 'pan', dx: 10, dy: 0 }]);
  });
  it('a palm cancelled before pen-up still lets a finger draw in finger mode', () => {
    const r = new InputRouter('pen');
    feed(r, [s('down', 2, 'touch', 100, 100), s('down', 1, 'pen', 0, 0), s('cancel', 2, 'touch', 100, 100), s('up', 1, 'pen', 0, 0)]);
    r.setMode('finger');
    expect(kinds(feed(r, [s('down', 4, 'touch', 5, 5), s('up', 4, 'touch', 5, 5)]))).toEqual(['stroke-begin', 'stroke-end']);
  });
  it('a palm that stays down after pen-up does not cause a pan jump', () => {
    const r = new InputRouter('pen');
    feed(r, [s('down', 2, 'touch', 100, 100), s('move', 2, 'touch', 140, 100), s('down', 1, 'pen', 0, 0), s('up', 1, 'pen', 0, 0)]);
    expect(feed(r, [s('move', 2, 'touch', 141, 100)])).toEqual([]);
  });
});
