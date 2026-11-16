import { canonicalJson, sha256Hex } from './hash';
import type { Author, Id } from './types';

export type AuditAction =
  | 'doc.create' | 'stroke.add' | 'stroke.hide' | 'stroke.unhide' | 'objects.move'
  | 'shape.add' | 'shape.hide' | 'shape.unhide' | 'page.add' | 'page.remove' | 'page.reorder'
  | 'preset.save' | 'doc.import' | 'doc.replace' | 'text.add' | 'text.edit' | 'text.hide' | 'text.unhide';

export interface AuditEntry {
  seq: number;
  time: number;
  profileId: Id;
  profileName: string;
  action: AuditAction;
  objectIds: Id[];
  prevHash: string;
  hash: string;
}

export const GENESIS_HASH = '0'.repeat(64);

function entryHash(e: Omit<AuditEntry, 'hash'>): Promise<string> {
  const { seq, time, profileId, profileName, action, objectIds, prevHash } = e;
  return sha256Hex(canonicalJson({ seq, time, profileId, profileName, action, objectIds, prevHash }));
}

export async function appendAudit(
  log: readonly AuditEntry[],
  e: { time: number; author: Author; action: AuditAction; objectIds: Id[] },
): Promise<AuditEntry[]> {
  const last = log[log.length - 1];
  const base = {
    seq: (last?.seq ?? 0) + 1,
    time: e.time,
    profileId: e.author.profileId,
    profileName: e.author.name,
    action: e.action,
    objectIds: [...e.objectIds],
    prevHash: last?.hash ?? GENESIS_HASH,
  };
  return [...log, { ...base, hash: await entryHash(base) }];
}

export async function verifyAudit(
  log: readonly AuditEntry[],
): Promise<{ ok: true } | { ok: false; brokenAt: number }> {
  let prev = GENESIS_HASH;
  for (let i = 0; i < log.length; i++) {
    const e = log[i];
    if (e.seq !== i + 1 || e.prevHash !== prev || (await entryHash(e)) !== e.hash) {
      return { ok: false, brokenAt: i };
    }
    prev = e.hash;
  }
  return { ok: true };
}
