import { canonicalJson, sha256Hex } from '../src/hash';
import { appendAudit, verifyAudit, GENESIS_HASH, type AuditEntry } from '../src/audit';

const author = { profileId: 'p1', name: 'สมชาย' };

async function build(n: number): Promise<AuditEntry[]> {
  let log: AuditEntry[] = [];
  for (let i = 0; i < n; i++) {
    log = await appendAudit(log, { time: 1000 + i, author, action: 'stroke.add', objectIds: [`s${i}`] });
  }
  return log;
}

describe('canonicalJson', () => {
  it('sorts keys recursively without whitespace', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });
});

describe('sha256Hex', () => {
  it('hashes "abc"', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('audit log', () => {
  it('chains entries from genesis with seq 1..n', async () => {
    const log = await build(3);
    expect(log.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(log[0].prevHash).toBe(GENESIS_HASH);
    expect(log[1].prevHash).toBe(log[0].hash);
    expect(log[2].prevHash).toBe(log[1].hash);
    expect(log[0].profileName).toBe('สมชาย');
  });
  it('does not mutate the input array', async () => {
    const log = await build(1);
    const next = await appendAudit(log, { time: 5, author, action: 'stroke.hide', objectIds: ['s0'] });
    expect(log).toHaveLength(1);
    expect(next).toHaveLength(2);
  });
  it('verifies an intact log', async () => {
    expect(await verifyAudit(await build(3))).toEqual({ ok: true });
  });
  it('detects a modified entry', async () => {
    const log = await build(3);
    log[1] = { ...log[1], objectIds: ['tampered'] };
    expect(await verifyAudit(log)).toEqual({ ok: false, brokenAt: 1 });
  });
  it('detects a deleted entry', async () => {
    const log = await build(3);
    log.splice(1, 1);
    expect(await verifyAudit(log)).toEqual({ ok: false, brokenAt: 1 });
  });
});
