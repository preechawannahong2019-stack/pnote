import { appendAudit, type AuditEntry } from '@pnote/core/audit';
import { History, type Command } from '@pnote/core/history';
import type { Author, DocumentMeta, Id } from '@pnote/core/types';
import type { AuditRecord } from '@pnote/core/doc-state';
import type { Library } from '@pnote/storage/library';
import { createAutosave } from './autosave';
import { acquireDocLock, type DocLock } from './doc-lock';

function pagesTouched(c: Command): Id[] {
  switch (c.type) {
    case 'addStroke': return [c.stroke.pageId];
    case 'addShape': return [c.shape.pageId];
    case 'hideObjects': case 'unhideObjects': case 'moveObjects': return [c.pageId];
    default: return [];
  }
}

export interface SessionOptions { lock?: (docId: Id) => Promise<DocLock>; now?: () => number; autosaveMs?: number }

export class EditorSession {
  readonly history: History;
  private audit: AuditEntry[];
  private dirty = new Set<Id>();
  private chain: Promise<void> = Promise.resolve();
  private autosave: ReturnType<typeof createAutosave>;
  private now: () => number;

  private constructor(
    private lib: Library,
    readonly author: Author,
    public meta: DocumentMeta,
    state: ConstructorParameters<typeof History>[0],
    audit: AuditEntry[],
    private lock: DocLock,
    opts: SessionOptions,
  ) {
    this.history = new History(state);
    this.audit = audit;
    this.now = opts.now ?? (() => Date.now());
    this.autosave = createAutosave(() => this.save(), opts.autosaveMs);
  }

  static async open(lib: Library, author: Author, docId: Id, opts: SessionOptions = {}): Promise<EditorSession> {
    const lock = await (opts.lock ?? acquireDocLock)(docId);
    const { meta, state, audit } = await lib.openDocument(docId);
    return new EditorSession(lib, author, meta, state, audit, lock, opts);
  }

  get readOnly(): boolean { return this.lock.readOnly; }

  private enqueue(fn: () => Promise<void>): Promise<void> {
    this.chain = this.chain.then(fn, fn);
    return this.chain;
  }

  private record(records: AuditRecord[] | null, pages: Id[]): Promise<void> {
    if (!records) return this.chain;
    pages.forEach((p) => this.dirty.add(p));
    return this.enqueue(async () => {
      for (const r of records) {
        this.audit = await appendAudit(this.audit, { time: this.now(), author: this.author, action: r.action, objectIds: r.objectIds });
      }
      this.autosave.schedule();
    });
  }

  run(c: Command): Promise<void> {
    if (this.readOnly) return Promise.resolve();
    return this.record(this.history.apply(c), pagesTouched(c));
  }

  undo(): Promise<void> {
    if (this.readOnly) return Promise.resolve();
    return this.record(this.history.undo(), this.history.state.pages.map((p) => p.id));
  }

  redo(): Promise<void> {
    if (this.readOnly) return Promise.resolve();
    return this.record(this.history.redo(), this.history.state.pages.map((p) => p.id));
  }

  private async save(): Promise<void> {
    await this.chain;
    const dirty = [...this.dirty];
    this.dirty.clear();
    await this.lib.saveDocument(this.meta, this.history.state, this.audit, dirty);
    this.meta = { ...this.meta, pages: this.history.state.pages };
  }

  /** Wait for queued audit writes and any running save. */
  async idle(): Promise<void> {
    await this.chain;
    await this.autosave.flush();
  }

  async flushNow(): Promise<void> {
    if (this.readOnly) return;
    await this.chain;
    await this.autosave.flush();
  }

  async close(): Promise<void> {
    await this.flushNow();
    this.autosave.dispose();
    if (!this.lock.readOnly) this.lock.release();
  }
}
