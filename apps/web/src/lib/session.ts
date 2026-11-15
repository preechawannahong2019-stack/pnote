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

export const SAVE_RETRY_MS = 5_000;

export interface SessionOptions { lock?: (docId: Id) => Promise<DocLock>; now?: () => number; autosaveMs?: number }

export class EditorSession {
  readonly history: History;
  private audit: AuditEntry[];
  private dirty = new Set<Id>();
  private chain: Promise<void> = Promise.resolve();
  private autosave: ReturnType<typeof createAutosave>;
  private now: () => number;
  private errorListeners = new Set<(e: unknown) => void>();
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  saveFailed = false;

  private constructor(
    private lib: Library,
    readonly author: Author,
    public meta: DocumentMeta,
    state: ConstructorParameters<typeof History>[0],
    audit: AuditEntry[],
    private lock: DocLock,
    opts: SessionOptions,
    readonly auditBroken = false,
  ) {
    this.history = new History(state);
    this.audit = audit;
    this.now = opts.now ?? (() => Date.now());
    this.autosave = createAutosave(() => this.save(), opts.autosaveMs);
  }

  static async open(lib: Library, author: Author, docId: Id, opts: SessionOptions = {}): Promise<EditorSession> {
    const lock = await (opts.lock ?? acquireDocLock)(docId);
    try {
      const { meta, state, audit, auditOk } = await lib.openDocument(docId);
      return new EditorSession(lib, author, meta, state, audit, lock, opts, !auditOk);
    } catch (e) {
      if (!lock.readOnly) lock.release();
      throw e;
    }
  }

  get readOnly(): boolean { return this.lock.readOnly; }

  private enqueue(fn: () => Promise<void>): Promise<void> {
    this.chain = this.chain.then(fn, fn);
    return this.chain;
  }

  private record(records: AuditRecord[] | null, pages: Id[]): Promise<void> {
    if (!records) return this.chain;
    pages.forEach((p) => this.dirty.add(p));
    const time = this.now();
    // schedule synchronously so a pagehide that arrives before the audit hash resolves still saves
    this.autosave.schedule();
    return this.enqueue(async () => {
      for (const r of records) {
        this.audit = await appendAudit(this.audit, { time, author: this.author, action: r.action, objectIds: r.objectIds });
      }
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

  onSaveError(cb: (e: unknown) => void): () => void {
    this.errorListeners.add(cb);
    return () => this.errorListeners.delete(cb);
  }

  private async save(): Promise<void> {
    await this.chain;
    const dirty = [...this.dirty];
    this.dirty.clear();
    try {
      await this.lib.saveDocument(this.meta, this.history.state, this.audit, dirty);
      this.meta = { ...this.meta, pages: this.history.state.pages };
      this.saveFailed = false;
      if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    } catch (e) {
      dirty.forEach((p) => this.dirty.add(p)); // keep them for the next attempt
      this.saveFailed = true;
      this.errorListeners.forEach((cb) => cb(e));
      if (!this.retryTimer) {
        this.retryTimer = setTimeout(() => { this.retryTimer = null; this.autosave.schedule(); }, SAVE_RETRY_MS);
      }
      throw e;
    }
  }

  /** Wait for queued audit writes and any running save. */
  async idle(): Promise<void> {
    await this.chain;
    await this.autosave.flush().catch(() => {});
  }

  async flushNow(): Promise<void> {
    if (this.readOnly) return;
    await this.chain;
    if (this.saveFailed) this.autosave.schedule();
    await this.autosave.flush();
  }

  /** Always resolves; a failed final save has already been reported through onSaveError. */
  async close(): Promise<void> {
    try { await this.flushNow(); } catch { /* reported */ }
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.autosave.dispose();
    if (!this.lock.readOnly) this.lock.release();
  }
}
