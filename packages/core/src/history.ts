import { applyCommand, auditRecordsFor, invertCommand, type AuditRecord, type Command, type DocState } from './doc-state';

export { applyCommand, invertCommand, type AuditRecord, type Command, type DocState } from './doc-state';

interface Entry { forward: Command; inverse: Command[] }

export class History {
  private _state: DocState;
  private undoStack: Entry[] = [];
  private redoStack: Entry[] = [];
  private listeners = new Set<(s: DocState) => void>();

  constructor(initial: DocState) {
    this._state = initial;
  }

  get state(): DocState { return this._state; }
  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }

  private run(cmds: Command[]): AuditRecord[] {
    const records: AuditRecord[] = [];
    for (const c of cmds) {
      records.push(...auditRecordsFor(this._state, c));
      this._state = applyCommand(this._state, c);
    }
    this.listeners.forEach((cb) => cb(this._state));
    return records;
  }

  apply(c: Command): AuditRecord[] {
    const inverse = invertCommand(this._state, c);
    this.undoStack.push({ forward: c, inverse });
    this.redoStack = [];
    return this.run([c]);
  }

  undo(): AuditRecord[] | null {
    const e = this.undoStack.pop();
    if (!e) return null;
    this.redoStack.push(e);
    return this.run(e.inverse);
  }

  redo(): AuditRecord[] | null {
    const e = this.redoStack.pop();
    if (!e) return null;
    this.undoStack.push(e);
    return this.run([e.forward]);
  }

  onChange(cb: (s: DocState) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
}
