import { History, applyCommand } from '../src/history';
import { decodePage, encodePage } from '../src/serialize';
import type { TextBox } from '../src/types';
import { author, emptyState, stroke } from './fixtures';

function box(id: string, text = 'ผู้ต้องหา ๒ คน', pageId = 'pg1'): TextBox {
  return { id, pageId, x: 10, y: 20, w: 200, h: 30, text, font: 'sarabun', sizePt: 16, color: '#000', bold: false, author, createdAt: 1, updatedAt: 1 };
}

describe('text boxes', () => {
  it('adds a text box with a text.add record', () => {
    const h = new History(emptyState());
    expect(h.apply({ type: 'addTextBox', box: box('t1') })).toEqual([{ action: 'text.add', objectIds: ['t1'] }]);
    expect(h.state.textBoxes.pg1.map((b) => b.id)).toEqual(['t1']);
  });

  it('edit, undo restores the previous fields, redo re-applies', () => {
    const h = new History(emptyState());
    h.apply({ type: 'addTextBox', box: box('t1', 'เดิม') });
    expect(h.apply({ type: 'editTextBox', pageId: 'pg1', id: 't1', patch: { text: 'ใหม่', bold: true }, updatedAt: 5 })).toEqual([{ action: 'text.edit', objectIds: ['t1'] }]);
    expect(h.state.textBoxes.pg1[0]).toMatchObject({ text: 'ใหม่', bold: true, updatedAt: 5 });
    expect(h.undo()).toEqual([{ action: 'text.edit', objectIds: ['t1'] }]);
    expect(h.state.textBoxes.pg1[0]).toMatchObject({ text: 'เดิม', bold: false, updatedAt: 1 });
    h.redo();
    expect(h.state.textBoxes.pg1[0].text).toBe('ใหม่');
  });

  it('hides and unhides via hideObjects with text.* records', () => {
    const h = new History(emptyState());
    h.apply({ type: 'addStroke', stroke: stroke('s1') });
    h.apply({ type: 'addTextBox', box: box('t1') });
    expect(h.apply({ type: 'hideObjects', pageId: 'pg1', ids: ['s1', 't1'] })).toEqual([
      { action: 'stroke.hide', objectIds: ['s1'] },
      { action: 'text.hide', objectIds: ['t1'] },
    ]);
    expect(h.state.textBoxes.pg1[0].hidden).toBe(true);
    expect(h.undo()).toEqual([{ action: 'stroke.unhide', objectIds: ['s1'] }, { action: 'text.unhide', objectIds: ['t1'] }]);
  });

  it('moveObjects shifts text boxes', () => {
    const h = new History(emptyState());
    h.apply({ type: 'addTextBox', box: box('t1') });
    h.apply({ type: 'moveObjects', pageId: 'pg1', ids: ['t1'], dx: 5, dy: -5 });
    expect(h.state.textBoxes.pg1[0]).toMatchObject({ x: 15, y: 15 });
  });

  it('applyCommand does not mutate input', () => {
    const s = applyCommand(emptyState(), { type: 'addTextBox', box: box('t1') });
    const snap = structuredClone(s);
    applyCommand(s, { type: 'editTextBox', pageId: 'pg1', id: 't1', patch: { text: 'x' }, updatedAt: 2 });
    applyCommand(s, { type: 'moveObjects', pageId: 'pg1', ids: ['t1'], dx: 1, dy: 1 });
    expect(s).toEqual(snap);
  });
});

describe('page files with text boxes', () => {
  it('round-trips Thai text exactly', () => {
    const out = decodePage(encodePage([stroke('s1')], [], [box('t1')]));
    expect(out.textBoxes).toEqual([box('t1')]);
    expect(out.strokes).toHaveLength(1);
  });
  it('decodes a stage 1 page file with no text boxes', () => {
    expect(decodePage(encodePage([stroke('s1')], [])).textBoxes).toEqual([]);
  });
});
