import type { Id } from '@pnote/core/types';

export type DocLock = { readOnly: false; release(): void } | { readOnly: true };

export const READ_ONLY_MESSAGE = 'เอกสารนี้เปิดอยู่ในแท็บอื่น — เปิดแบบอ่านอย่างเดียว';

/** One writer per document across tabs (Web Locks API). Browsers without it get a writable lock. */
export function acquireDocLock(docId: Id): Promise<DocLock> {
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  if (!locks) return Promise.resolve({ readOnly: false, release: () => {} });
  return new Promise((resolve) => {
    void locks.request(`pnote-doc-${docId}`, { ifAvailable: true }, (lock) => {
      if (!lock) { resolve({ readOnly: true }); return; }
      return new Promise<void>((release) => resolve({ readOnly: false, release: () => release() }));
    });
  });
}
