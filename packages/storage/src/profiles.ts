import type { Id } from '@pnote/core/types';
import { newId } from '@pnote/core/ids';
import type { StorageAdapter } from './adapter';
import {
  deriveKek, generateDataKey, generateRecoveryCode, normalizeRecoveryCode, randomBytes, unwrapDataKey, wrapDataKey, WrongKeyError,
} from './crypto';
import { DeviceKeyMissing, type DeviceKeyProvider } from './device-key';
import { EncryptedStore } from './encrypted-store';

export interface ProfileSummary { id: Id; name: string; avatarColor: string; locked: boolean; createdAt: number }

export type UnlockResult =
  | { ok: true; profile: ProfileSummary; store: EncryptedStore; key: CryptoKey }
  | { ok: false; reason: 'wrong'; attemptsLeft: number }
  | { ok: false; reason: 'delayed'; retryAfterMs: number }
  | { ok: false; reason: 'locked' }
  | { ok: false; reason: 'device-key-missing' };

export class WeakSecretError extends Error {
  constructor(min: number) { super(`secret must be at least ${min} characters`); this.name = 'WeakSecretError'; }
}

export const MIN_WEB_SECRET_LENGTH = 8;
export const MIN_DEVICE_PIN_LENGTH = 6;
export const MAX_ATTEMPTS = 10;
export const DELAY_FROM_ATTEMPT = 5;
export const BASE_DELAY_MS = 30_000;

interface ProfileRecord {
  id: Id;
  name: string;
  avatarColor: string;
  createdAt: number;
  salt: string;
  wrappedBySecret: string;
  recoverySalt: string;
  wrappedByRecovery: string;
  failedAttempts: number;
  nextAllowedAt: number;
  locked: boolean;
}

const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const recordPath = (id: Id) => `/_profiles/${id}.json`;

function summary(r: ProfileRecord): ProfileSummary {
  return { id: r.id, name: r.name, avatarColor: r.avatarColor, locked: r.locked, createdAt: r.createdAt };
}

export class ProfileService {
  private queues = new Map<Id, Promise<unknown>>();

  constructor(private adapter: StorageAdapter, private device: DeviceKeyProvider, private now: () => number = () => Date.now()) {}

  /** Serialize operations per profile so parallel attempts are each counted. */
  private exclusive<T>(id: Id, fn: () => Promise<T>): Promise<T> {
    // across tabs: Web Locks; within this instance: a promise queue
    const locks = (globalThis.navigator as (Navigator & { locks?: LockManager }) | undefined)?.locks;
    const run = locks ? () => locks.request(`pnote-profile-${id}`, fn) as Promise<T> : fn;
    const prev = this.queues.get(id) ?? Promise.resolve();
    const next = prev.then(run, run);
    this.queues.set(id, next.catch(() => undefined));
    return next;
  }

  private async read(id: Id): Promise<ProfileRecord | null> {
    const raw = await this.adapter.get(recordPath(id));
    return raw ? (JSON.parse(new TextDecoder().decode(raw)) as ProfileRecord) : null;
  }

  private async write(r: ProfileRecord): Promise<void> {
    await this.adapter.put(recordPath(r.id), new TextEncoder().encode(JSON.stringify(r)));
  }

  private checkSecret(secret: string): void {
    const min = this.device.available ? MIN_DEVICE_PIN_LENGTH : MIN_WEB_SECRET_LENGTH;
    if (secret.length < min) throw new WeakSecretError(min);
  }

  private async wrapForSecret(dataKey: CryptoKey, secret: string): Promise<{ salt: string; wrappedBySecret: string }> {
    const salt = randomBytes(16);
    const wrapped = await wrapDataKey(dataKey, await deriveKek(secret, salt));
    return { salt: b64(salt), wrappedBySecret: b64(await this.device.wrap(wrapped)) };
  }

  async list(): Promise<ProfileSummary[]> {
    const paths = await this.adapter.list('/_profiles/');
    const recs = await Promise.all(paths.map(async (p) => JSON.parse(new TextDecoder().decode((await this.adapter.get(p))!)) as ProfileRecord));
    return recs.map(summary).sort((a, b) => a.createdAt - b.createdAt);
  }

  async create(name: string, secret: string, avatarColor: string): Promise<{ profile: ProfileSummary; recoveryCode: string }> {
    this.checkSecret(secret);
    const dataKey = await generateDataKey();
    const recoveryCode = generateRecoveryCode();
    const recoverySalt = randomBytes(16);
    const wrappedByRecovery = await wrapDataKey(dataKey, await deriveKek(normalizeRecoveryCode(recoveryCode), recoverySalt));
    const rec: ProfileRecord = {
      id: newId(),
      name,
      avatarColor,
      createdAt: this.now(),
      ...(await this.wrapForSecret(dataKey, secret)),
      recoverySalt: b64(recoverySalt),
      wrappedByRecovery: b64(wrappedByRecovery),
      failedAttempts: 0,
      nextAllowedAt: 0,
      locked: false,
    };
    await this.write(rec);
    return { profile: summary(rec), recoveryCode };
  }

  /** A new profile to restore a backup into: same rules as create(); the caller then imports the documents. */
  createFromBackup(name: string, secret: string, avatarColor: string): Promise<{ profile: ProfileSummary; recoveryCode: string }> {
    return this.create(name, secret, avatarColor);
  }

  unlock(id: Id, secret: string): Promise<UnlockResult> {
    return this.exclusive(id, async () => {
      const rec = await this.read(id);
      if (!rec) throw new Error(`no profile ${id}`);
      if (rec.locked) return { ok: false, reason: 'locked' };
      const t = this.now();
      if (t < rec.nextAllowedAt) return { ok: false, reason: 'delayed', retryAfterMs: rec.nextAllowedAt - t };
      // the hardware key comes first: if it is gone, no PIN can help, so no attempt is counted
      let wrapped: Uint8Array;
      try {
        wrapped = await this.device.unwrap(unb64(rec.wrappedBySecret));
      } catch (e) {
        if (e instanceof DeviceKeyMissing) return { ok: false, reason: 'device-key-missing' };
        throw e;
      }
      // count the attempt as failed before the slow key derivation; undone on success
      const failed = rec.failedAttempts + 1;
      const locked = failed >= MAX_ATTEMPTS;
      const nextAllowedAt = failed >= DELAY_FROM_ATTEMPT ? t + BASE_DELAY_MS * 2 ** (failed - DELAY_FROM_ATTEMPT) : 0;
      await this.write({ ...rec, failedAttempts: failed, nextAllowedAt, locked });
      try {
        const key = await unwrapDataKey(wrapped, await deriveKek(secret, unb64(rec.salt)));
        await this.write({ ...rec, failedAttempts: 0, nextAllowedAt: 0, locked: false });
        return { ok: true, profile: summary({ ...rec, locked: false }), key, store: new EncryptedStore(this.adapter, key, id) };
      } catch (e) {
        if (!(e instanceof WrongKeyError)) throw e;
        return locked ? { ok: false, reason: 'locked' } : { ok: false, reason: 'wrong', attemptsLeft: MAX_ATTEMPTS - failed };
      }
    });
  }

  recover(id: Id, recoveryCode: string, newSecret: string): Promise<UnlockResult> {
    this.checkSecret(newSecret);
    return this.exclusive(id, async () => {
      const rec = await this.read(id);
      if (!rec) throw new Error(`no profile ${id}`);
      let exportable: CryptoKey;
      let key: CryptoKey;
      try {
        const kek = await deriveKek(normalizeRecoveryCode(recoveryCode), unb64(rec.recoverySalt));
        exportable = await unwrapDataKey(unb64(rec.wrappedByRecovery), kek, true);
        key = await unwrapDataKey(unb64(rec.wrappedByRecovery), kek);
      } catch (e) {
        if (e instanceof WrongKeyError) return { ok: false, reason: 'wrong', attemptsLeft: MAX_ATTEMPTS - rec.failedAttempts };
        throw e;
      }
      const next: ProfileRecord = { ...rec, ...(await this.wrapForSecret(exportable, newSecret)), failedAttempts: 0, nextAllowedAt: 0, locked: false };
      await this.write(next);
      return { ok: true, profile: summary(next), key, store: new EncryptedStore(this.adapter, key, id) };
    });
  }

  rename(id: Id, name: string): Promise<void> {
    return this.exclusive(id, async () => {
      const rec = await this.read(id);
      if (!rec) throw new Error(`no profile ${id}`);
      await this.write({ ...rec, name });
    });
  }
}
