import { __setKdfParamsForTest, CHUNK_SIZE, createChunkDecryptor, createChunkEncryptor, generateDataKey, TamperedError } from '../src/crypto';
import { BackupCorrupt, BackupReader, BackupUnsupported, BackupWriter, BackupWrongPassword, type BackupSink, MIN_BACKUP_PASSWORD } from '../src/backup';
import type { BlobSource } from '../src/blob-store';

beforeAll(() => __setKdfParamsForTest({ memoryKiB: 1024 }));

const PW = 'backup-password-1';
const same = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b));
function bytes(n: number, seed = 1) { const b = new Uint8Array(n); for (let i = 0; i < n; i++) b[i] = (i * 31 + seed) & 255; return b; }

function memSink() {
  const parts: Uint8Array[] = [];
  const sink: BackupSink & { bytes(): Uint8Array; written: number } = {
    written: 0,
    async write(b) { parts.push(b.slice()); sink.written += b.length; },
    async close() {}, async abort() { parts.length = 0; },
    bytes() { const out = new Uint8Array(sink.written); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; },
  };
  return sink;
}
function src(b: Uint8Array, onRead?: (end: number) => void): BlobSource {
  return { size: b.length, slice: async (s, e) => { onRead?.(e); return b.slice(s, e); } };
}
async function readAll(r: BackupReader) {
  const out = new Map<string, Uint8Array>();
  await r.entries((path) => {
    const parts: Uint8Array[] = [];
    return { write: async (c) => { parts.push(c.slice()); }, end: async () => { out.set(path, Buffer.concat(parts)); } };
  });
  return out;
}
async function make(files: [string, Uint8Array][], kind: 'document' | 'profile' = 'document') {
  const sink = memSink();
  const w = await BackupWriter.create(sink, kind, PW);
  for (const [p, b] of files) await w.addFile(p, b, true);
  await w.close();
  return sink.bytes();
}

describe('streaming chunk encryption', () => {
  it('round-trips data pushed in odd pieces, including an exact multiple of the chunk size', async () => {
    for (const n of [0, 5, CHUNK_SIZE, CHUNK_SIZE * 2 + 7]) {
      const key = await generateDataKey();
      const ctx = new TextEncoder().encode('ctx');
      const enc = createChunkEncryptor(key, ctx);
      const plain = bytes(n);
      const cipher: Uint8Array[] = [];
      for (let i = 0; i < n; i += 300_001) cipher.push(...(await enc.push(plain.subarray(i, i + 300_001))));
      cipher.push(...(await enc.finish()));
      const dec = createChunkDecryptor(key, ctx);
      const out: Uint8Array[] = [];
      for (const c of cipher) for (let i = 0; i < c.length; i += 77_777) out.push(...(await dec.push(c.subarray(i, i + 77_777))));
      out.push(...(await dec.finish()));
      expect(same(Buffer.concat(out), plain)).toBe(true);
    }
  });

  it('detects a truncated stream', async () => {
    const key = await generateDataKey();
    const enc = createChunkEncryptor(key, new Uint8Array());
    const cipher = [...(await enc.push(bytes(CHUNK_SIZE + 10))), ...(await enc.finish())];
    const dec = createChunkDecryptor(key, new Uint8Array());
    await dec.push(cipher[0]); // the final chunk never arrives
    await expect(dec.finish()).rejects.toBeInstanceOf(TamperedError);
  });
});

describe('.pnote files', () => {
  it('round-trips files, one larger than a chunk', async () => {
    const files: [string, Uint8Array][] = [['a.json', new TextEncoder().encode('{"x":"สำนวน"}')], ['big.bin', bytes(2_500_000)], ['empty', new Uint8Array()]];
    const r = await BackupReader.open(src(await make(files)), PW);
    expect(r.header.kind).toBe('document');
    const got = await readAll(r);
    for (const [p, b] of files) expect(same(got.get(p)!, b)).toBe(true);
  });

  it('tells a wrong password from a damaged file', async () => {
    const file = await make([['a', bytes(1000)]]);
    await expect(BackupReader.open(src(file), 'wrong-password-x')).rejects.toBeInstanceOf(BackupWrongPassword);
    const flipped = file.slice(); flipped[flipped.length - 40] ^= 1;
    await expect(readAll(await BackupReader.open(src(flipped), PW))).rejects.toBeInstanceOf(BackupCorrupt);
    const cut = file.slice(0, file.length - 30);
    await expect(readAll(await BackupReader.open(src(cut), PW))).rejects.toBeInstanceOf(BackupCorrupt);
  });

  it('binds the header: changing the kind breaks the body', async () => {
    const file = await make([['a', bytes(10)]]);
    const text = new TextDecoder('latin1').decode(file);
    const swapped = new Uint8Array(Buffer.from(text.replace('"kind":"document"', '"kind":"profile"'), 'latin1'));
    await expect(BackupReader.open(src(swapped), PW).then(readAll)).rejects.toBeInstanceOf(BackupCorrupt);
    // a same-length edit parses but no longer matches the body's AAD
    const created = /"createdAt":(\d+)/.exec(text)![1];
    const edited = created.slice(0, -1) + ((Number(created.slice(-1)) + 1) % 10);
    const sameLen = new Uint8Array(Buffer.from(text.replace(`"createdAt":${created}`, `"createdAt":${edited}`), 'latin1'));
    await expect(readAll(await BackupReader.open(src(sameLen), PW))).rejects.toBeInstanceOf(BackupCorrupt);
  });

  it('refuses unknown versions and short passwords', async () => {
    const file = await make([['a', bytes(10)]]);
    const text = new TextDecoder('latin1').decode(file);
    const v2 = new Uint8Array(Buffer.from(text.replace('"version":1', '"version":2'), 'latin1'));
    await expect(BackupReader.open(src(v2), PW)).rejects.toBeInstanceOf(BackupUnsupported);
    await expect(BackupWriter.create(memSink(), 'document', 'x'.repeat(MIN_BACKUP_PASSWORD - 1))).rejects.toThrow();
    await expect(BackupReader.open(src(new TextEncoder().encode('not a backup')), PW)).rejects.toBeInstanceOf(BackupUnsupported);
  });

  it('streams: never more than 4 MB between reading the input and writing the output', async () => {
    const big = bytes(20_000_000, 7);
    let read = 0;
    let peak = 0;
    const sink = memSink();
    const origWrite = sink.write.bind(sink);
    sink.write = async (b) => { await origWrite(b); peak = Math.max(peak, read - sink.written); };
    const w = await BackupWriter.create(sink, 'document', PW);
    await w.addFile('big', src(big, (end) => { read = end; peak = Math.max(peak, read - sink.written); }), false);
    await w.close();
    expect(peak).toBeLessThan(4_000_000);

    const file = sink.bytes();
    let fileRead = 0; let delivered = 0; let peak2 = 0;
    const r = await BackupReader.open(src(file, (end) => { fileRead = end; }), PW);
    await r.entries(() => ({ write: async (c) => { delivered += c.length; peak2 = Math.max(peak2, fileRead - delivered); }, end: async () => {} }));
    expect(delivered).toBe(big.length);
    expect(peak2).toBeLessThan(4_000_000);
  });
});
