import { argon2id } from 'hash-wasm';

export const KDF_PARAMS = { memoryKiB: 65536, iterations: 3, parallelism: 1, hashLength: 32 };

/** Test hook: lower Argon2 memory so unit tests stay fast. */
export function __setKdfParamsForTest(p: Partial<typeof KDF_PARAMS>): void {
  Object.assign(KDF_PARAMS, p);
}

export class WrongKeyError extends Error {
  constructor() { super('wrong key'); this.name = 'WrongKeyError'; }
}
export class TamperedError extends Error {
  constructor(msg = 'data was modified or the key is wrong') { super(msg); this.name = 'TamperedError'; }
}

const buf = (b: Uint8Array) => b as Uint8Array<ArrayBuffer>;

export function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

export async function deriveKek(secret: string, salt: Uint8Array): Promise<CryptoKey> {
  const raw = await argon2id({
    password: secret.normalize('NFC'),
    salt,
    memorySize: KDF_PARAMS.memoryKiB,
    iterations: KDF_PARAMS.iterations,
    parallelism: KDF_PARAMS.parallelism,
    hashLength: KDF_PARAMS.hashLength,
    outputType: 'binary',
  });
  return crypto.subtle.importKey('raw', buf(raw), 'AES-KW', false, ['wrapKey', 'unwrapKey']);
}

export function generateDataKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

export async function wrapDataKey(dataKey: CryptoKey, kek: CryptoKey): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.wrapKey('raw', dataKey, kek, 'AES-KW'));
}

/** Session keys are non-extractable; pass extractable=true only to re-wrap the key (recovery). */
export async function unwrapDataKey(wrapped: Uint8Array, kek: CryptoKey, extractable = false): Promise<CryptoKey> {
  try {
    return await crypto.subtle.unwrapKey('raw', buf(wrapped), kek, 'AES-KW', { name: 'AES-GCM', length: 256 }, extractable, ['encrypt', 'decrypt']);
  } catch {
    throw new WrongKeyError();
  }
}

export const CHUNK_SIZE = 1_048_576;
const MAGIC = [0x50, 0x4e, 0x43, 0x31]; // "PNC1"
const HEADER = 20;
const IV = 12;
const TAG = 16;

interface Header { chunkSize: number; count: number; plainLength: number }

function readHeader(data: Uint8Array): Header {
  if (data.length < HEADER || MAGIC.some((m, i) => data[i] !== m)) throw new TamperedError('not an encrypted file');
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return { chunkSize: v.getUint32(4, true), count: v.getUint32(8, true), plainLength: Number(v.getBigUint64(12, true)) };
}

const EMPTY = new Uint8Array(0);

/** AAD binds each chunk to its position, the file's chunk count and length, and a caller context (e.g. the file path). */
function aad(index: number, h: Header, context: Uint8Array): Uint8Array<ArrayBuffer> {
  const a = new Uint8Array(16 + context.length);
  const v = new DataView(a.buffer);
  v.setUint32(0, index, true);
  v.setUint32(4, h.count, true);
  v.setBigUint64(8, BigInt(h.plainLength), true);
  a.set(context, 16);
  return a;
}

export async function encryptBytes(key: CryptoKey, plain: Uint8Array, context: Uint8Array = EMPTY): Promise<Uint8Array> {
  const count = Math.max(1, Math.ceil(plain.length / CHUNK_SIZE));
  const h: Header = { chunkSize: CHUNK_SIZE, count, plainLength: plain.length };
  const parts: Uint8Array[] = [];
  let total = HEADER;
  for (let i = 0; i < count; i++) {
    const iv = randomBytes(IV);
    const chunk = plain.subarray(i * CHUNK_SIZE, Math.min(plain.length, (i + 1) * CHUNK_SIZE));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: buf(iv), additionalData: aad(i, h, context) }, key, buf(chunk.slice())));
    parts.push(iv, ct);
    total += IV + ct.length;
  }
  const out = new Uint8Array(total);
  out.set(MAGIC, 0);
  const v = new DataView(out.buffer);
  v.setUint32(4, CHUNK_SIZE, true);
  v.setUint32(8, count, true);
  v.setBigUint64(12, BigInt(plain.length), true);
  let off = HEADER;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

function chunkPlainLength(h: Header, index: number): number {
  return Math.max(0, Math.min(h.chunkSize, h.plainLength - index * h.chunkSize));
}

function chunkOffset(h: Header, index: number): number {
  return HEADER + index * (IV + h.chunkSize + TAG);
}

async function decryptAt(key: CryptoKey, data: Uint8Array, h: Header, index: number, context: Uint8Array): Promise<Uint8Array> {
  const off = chunkOffset(h, index);
  const len = IV + chunkPlainLength(h, index) + TAG;
  if (off + len > data.length) throw new TamperedError('file is truncated');
  try {
    const iv = data.slice(off, off + IV);
    const ct = data.slice(off + IV, off + len);
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad(index, h, context) }, key, ct));
  } catch {
    throw new TamperedError();
  }
}

export async function decryptChunk(key: CryptoKey, data: Uint8Array, index: number, context: Uint8Array = EMPTY): Promise<Uint8Array> {
  const h = readHeader(data);
  if (index < 0 || index >= h.count) throw new RangeError(`chunk ${index} out of range`);
  return decryptAt(key, data, h, index, context);
}

export async function decryptBytes(key: CryptoKey, data: Uint8Array, context: Uint8Array = EMPTY): Promise<Uint8Array> {
  const h = readHeader(data);
  if (h.chunkSize !== CHUNK_SIZE || h.count !== Math.max(1, Math.ceil(h.plainLength / h.chunkSize))) throw new TamperedError('bad header');
  const out = new Uint8Array(h.plainLength);
  for (let i = 0; i < h.count; i++) out.set(await decryptAt(key, data, h, i, context), i * h.chunkSize);
  if (chunkOffset(h, h.count - 1) + IV + chunkPlainLength(h, h.count - 1) + TAG !== data.length) throw new TamperedError('trailing data');
  return out;
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function generateRecoveryCode(): string {
  const r = randomBytes(24);
  const chars = Array.from(r, (b) => CROCKFORD[b & 31]).join('');
  return chars.match(/.{4}/g)!.join('-');
}

export function normalizeRecoveryCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
}

// ---- streaming form (for .pnote backups): chunks of CHUNK_SIZE plaintext, each `iv(12) || ciphertext+tag`.
// AAD = chunk index (u32 LE) · final flag (u8) · caller context. The last chunk is flagged final, so a stream cut
// at a chunk boundary is detected; the order of chunks is bound by the index.

function streamAad(index: number, final: boolean, context: Uint8Array): Uint8Array<ArrayBuffer> {
  const a = new Uint8Array(5 + context.length);
  new DataView(a.buffer).setUint32(0, index, true);
  a[4] = final ? 1 : 0;
  a.set(context, 5);
  return a;
}

function join(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (!a.length) return b.slice();
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

export function createChunkEncryptor(key: CryptoKey, context: Uint8Array): { push(plain: Uint8Array): Promise<Uint8Array[]>; finish(): Promise<Uint8Array[]> } {
  let pending: Uint8Array = new Uint8Array(0);
  let index = 0;
  const seal = async (chunk: Uint8Array, final: boolean) => {
    const iv = randomBytes(IV);
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: buf(iv), additionalData: streamAad(index++, final, context) }, key, buf(chunk.slice())));
    return join(iv, ct);
  };
  return {
    async push(plain) {
      pending = join(pending, plain);
      const out: Uint8Array[] = [];
      // keep at least one byte back: only finish() emits the final chunk
      while (pending.length > CHUNK_SIZE) {
        out.push(await seal(pending.subarray(0, CHUNK_SIZE), false));
        pending = pending.slice(CHUNK_SIZE);
      }
      return out;
    },
    async finish() {
      const last = await seal(pending, true);
      pending = new Uint8Array(0);
      return [last];
    },
  };
}

/** finish() returns the plaintext of the final chunk and throws TamperedError if the stream was cut or altered. */
export function createChunkDecryptor(key: CryptoKey, context: Uint8Array): { push(cipher: Uint8Array): Promise<Uint8Array[]>; finish(): Promise<Uint8Array[]> } {
  const FULL = IV + CHUNK_SIZE + TAG;
  let pending: Uint8Array = new Uint8Array(0);
  let index = 0;
  let ended = false;
  const open = async (chunk: Uint8Array, final: boolean) => {
    if (chunk.length < IV + TAG) throw new TamperedError('stream is truncated');
    try {
      return new Uint8Array(await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: chunk.slice(0, IV), additionalData: streamAad(index++, final, context) }, key, chunk.slice(IV)));
    } catch {
      throw new TamperedError();
    }
  };
  return {
    async push(cipher) {
      if (ended) throw new TamperedError('data after the end of the stream');
      pending = join(pending, cipher);
      const plain: Uint8Array[] = [];
      while (pending.length > FULL) {
        plain.push(await open(pending.subarray(0, FULL), false));
        pending = pending.slice(FULL);
      }
      return plain;
    },
    async finish() {
      ended = true;
      const last = await open(pending, true);
      pending = new Uint8Array(0);
      return [last];
    },
  };
}

/** AES-GCM key for a .pnote file, from its password (Argon2id with the parameters recorded in the file). */
export async function deriveBackupKey(password: string, salt: Uint8Array, p: { memoryKiB: number; iterations: number; parallelism: number }): Promise<CryptoKey> {
  const raw = await argon2id({ password: password.normalize('NFC'), salt, memorySize: p.memoryKiB, iterations: p.iterations, parallelism: p.parallelism, hashLength: 32, outputType: 'binary' });
  return crypto.subtle.importKey('raw', buf(raw), 'AES-GCM', false, ['encrypt', 'decrypt']);
}
