import { MemoryAdapter } from '../src/adapter';
import { __setKdfParamsForTest } from '../src/crypto';
import { WebNoDeviceKey, type DeviceKeyProvider } from '../src/device-key';
import { ProfileService, WeakSecretError } from '../src/profiles';

beforeAll(() => __setKdfParamsForTest({ memoryKiB: 1024 }));

function setup() {
  let t = 1_000_000;
  const clock = { now: () => t, advance: (ms: number) => { t += ms; } };
  const adapter = new MemoryAdapter();
  const svc = new ProfileService(adapter, WebNoDeviceKey, clock.now);
  return { clock, adapter, svc };
}

const PW = 'correct-horse';

describe('ProfileService', () => {
  it('creates a profile with a recovery code', async () => {
    const { svc } = setup();
    const { profile, recoveryCode } = await svc.create('สมชาย', PW, '#336699');
    expect(recoveryCode).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){5}[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(await svc.list()).toEqual([profile]);
    expect(profile).toMatchObject({ name: 'สมชาย', avatarColor: '#336699', locked: false });
  });

  it('rejects a web secret shorter than 8 characters', async () => {
    const { svc } = setup();
    await expect(svc.create('A', '1234567', '#000')).rejects.toBeInstanceOf(WeakSecretError);
    expect(await svc.list()).toEqual([]);
  });

  it('unlocks with the right secret and returns a working store', async () => {
    const { svc } = setup();
    const { profile } = await svc.create('A', PW, '#000');
    const r = await svc.unlock(profile.id, PW);
    if (!r.ok) throw new Error('expected ok');
    await r.store.putJSON('x.json', { a: 1 });
    expect(await r.store.getJSON('x.json')).toEqual({ a: 1 });
  });

  it('counts wrong attempts, delays from the 5th, locks at the 10th', async () => {
    const { svc, clock } = setup();
    const { profile } = await svc.create('A', PW, '#000');
    for (const left of [9, 8, 7, 6]) {
      expect(await svc.unlock(profile.id, 'nope-nope')).toEqual({ ok: false, reason: 'wrong', attemptsLeft: left });
    }
    expect(await svc.unlock(profile.id, 'nope-nope')).toEqual({ ok: false, reason: 'wrong', attemptsLeft: 5 });
    expect(await svc.unlock(profile.id, PW)).toEqual({ ok: false, reason: 'delayed', retryAfterMs: 30_000 });
    clock.advance(30_000);
    expect(await svc.unlock(profile.id, 'nope-nope')).toMatchObject({ reason: 'wrong', attemptsLeft: 4 });
    expect(await svc.unlock(profile.id, 'nope-nope')).toEqual({ ok: false, reason: 'delayed', retryAfterMs: 60_000 });
    for (const ms of [60_000, 120_000, 240_000]) {
      clock.advance(ms);
      await svc.unlock(profile.id, 'nope-nope');
    }
    clock.advance(480_000);
    expect(await svc.unlock(profile.id, 'nope-nope')).toEqual({ ok: false, reason: 'locked' });
    clock.advance(10_000_000);
    expect(await svc.unlock(profile.id, PW)).toEqual({ ok: false, reason: 'locked' });
    expect((await svc.list())[0].locked).toBe(true);
  });

  it('resets the counter after a successful unlock', async () => {
    const { svc } = setup();
    const { profile } = await svc.create('A', PW, '#000');
    await svc.unlock(profile.id, 'nope-nope');
    await svc.unlock(profile.id, PW);
    expect(await svc.unlock(profile.id, 'nope-nope')).toMatchObject({ attemptsLeft: 9 });
  });

  it('attempts survive a new ProfileService instance', async () => {
    const { svc, adapter, clock } = setup();
    const { profile } = await svc.create('A', PW, '#000');
    for (let i = 0; i < 5; i++) await svc.unlock(profile.id, 'nope-nope');
    const fresh = new ProfileService(adapter, WebNoDeviceKey, clock.now);
    expect(await fresh.unlock(profile.id, PW)).toEqual({ ok: false, reason: 'delayed', retryAfterMs: 30_000 });
  });

  it('counts parallel wrong attempts individually', async () => {
    const { svc } = setup();
    const { profile } = await svc.create('A', PW, '#000');
    await Promise.all([1, 2, 3].map(() => svc.unlock(profile.id, 'nope-nope')));
    expect(await svc.unlock(profile.id, 'nope-nope')).toMatchObject({ attemptsLeft: 6 });
  });

  it('recovers with the recovery code and keeps the data', async () => {
    const { svc, clock } = setup();
    const { profile, recoveryCode } = await svc.create('A', PW, '#000');
    const r1 = await svc.unlock(profile.id, PW);
    if (!r1.ok) throw new Error();
    await r1.store.putJSON('note.json', { v: 'kept' });
    for (let i = 0; i < 10; i++) { await svc.unlock(profile.id, 'nope-nope'); clock.advance(1_000_000); }
    const typed = recoveryCode.toLowerCase().replace(/-/g, ' ');
    const r2 = await svc.recover(profile.id, typed, 'new-password-1');
    expect(r2.ok).toBe(true);
    expect(await svc.unlock(profile.id, PW)).toMatchObject({ ok: false, reason: 'wrong' });
    const r3 = await svc.unlock(profile.id, 'new-password-1');
    if (!r3.ok) throw new Error();
    expect(await r3.store.getJSON('note.json')).toEqual({ v: 'kept' });
  });

  it('rejects a wrong recovery code', async () => {
    const { svc } = setup();
    const { profile } = await svc.create('A', PW, '#000');
    expect(await svc.recover(profile.id, 'AAAA-AAAA-AAAA-AAAA-AAAA-AAAA', 'new-password-1')).toMatchObject({ ok: false, reason: 'wrong' });
  });

  it('stores no plaintext secret and wraps through the device key when available', async () => {
    const calls: string[] = [];
    const device: DeviceKeyProvider = {
      available: true,
      wrap: async (b) => { calls.push('wrap'); return new Uint8Array([...b].reverse()); },
      unwrap: async (b) => { calls.push('unwrap'); return new Uint8Array([...b].reverse()); },
    };
    const adapter = new MemoryAdapter();
    const svc = new ProfileService(adapter, device);
    const { profile } = await svc.create('A', '123456', '#000');
    expect(calls).toContain('wrap');
    const raw = new TextDecoder().decode((await adapter.get(`/_profiles/${profile.id}.json`))!);
    expect(raw).not.toContain('123456');
    expect((await svc.unlock(profile.id, '123456')).ok).toBe(true);
    expect(calls).toContain('unwrap');
  });

  it('renames', async () => {
    const { svc } = setup();
    const { profile } = await svc.create('A', PW, '#000');
    await svc.rename(profile.id, 'B');
    expect((await svc.list())[0].name).toBe('B');
  });
});

describe('review fixes: keys and cross-tab attempts', () => {
  it('unlock and recover return a non-extractable data key', async () => {
    const { svc } = setup();
    const { profile, recoveryCode } = await svc.create('A', PW, '#000');
    const r = await svc.unlock(profile.id, PW);
    if (!r.ok) throw new Error();
    expect(r.key.extractable).toBe(false);
    const r2 = await svc.recover(profile.id, recoveryCode, 'new-password-1');
    if (!r2.ok) throw new Error();
    expect(r2.key.extractable).toBe(false);
  });

  it('counts wrong attempts made in parallel from two tabs', async () => {
    // a minimal shared Web Locks implementation, as two tabs of one origin would see
    const queues = new Map<string, Promise<unknown>>();
    const locks = {
      request: (name: string, cb: () => Promise<unknown>) => {
        const prev = queues.get(name) ?? Promise.resolve();
        const next = prev.then(cb, cb);
        queues.set(name, next.catch(() => undefined));
        return next;
      },
    };
    vi.stubGlobal('navigator', { locks });
    const adapter = new MemoryAdapter();
    const tab1 = new ProfileService(adapter, WebNoDeviceKey);
    const { profile } = await tab1.create('A', PW, '#000');
    const tab2 = new ProfileService(adapter, WebNoDeviceKey);
    await Promise.all([tab1.unlock(profile.id, 'nope-nope'), tab2.unlock(profile.id, 'nope-nope'), tab1.unlock(profile.id, 'nope-nope'), tab2.unlock(profile.id, 'nope-nope')]);
    expect(await tab1.unlock(profile.id, 'nope-nope')).toMatchObject({ attemptsLeft: 5 });
    vi.unstubAllGlobals();
  });

});

describe('stage 3: device key missing', () => {
  function flakyDevice() {
    let key = 7;
    const d = {
      available: true,
      lost: false,
      wrap: async (b: Uint8Array) => b.map((x) => x ^ key),
      unwrap: async (b: Uint8Array) => {
        if (d.lost) { const { DeviceKeyMissing } = await import('../src/device-key'); throw new DeviceKeyMissing(); }
        return b.map((x) => x ^ key);
      },
      reset() { key = 99; d.lost = false; },
    };
    return d;
  }

  it('reports device-key-missing without counting an attempt, and recovery re-wraps with the new device key', async () => {
    const adapter = new MemoryAdapter();
    const device = flakyDevice();
    const svc = new ProfileService(adapter, device);
    const { profile, recoveryCode } = await svc.create('A', '123456', '#000');
    device.lost = true; // e.g. app reinstalled: the hardware key is gone
    expect(await svc.unlock(profile.id, '123456')).toEqual({ ok: false, reason: 'device-key-missing' });
    expect(await svc.unlock(profile.id, '123456')).toEqual({ ok: false, reason: 'device-key-missing' });
    device.reset(); // a new hardware key is created on first wrap
    const r = await svc.recover(profile.id, recoveryCode, '654321');
    expect(r.ok).toBe(true);
    expect((await svc.unlock(profile.id, '654321')).ok).toBe(true);
    expect(await svc.unlock(profile.id, '111111')).toMatchObject({ reason: 'wrong', attemptsLeft: 9 });
  });
});
