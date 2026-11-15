import {
  __setKdfParamsForTest, CHUNK_SIZE, decryptBytes, decryptChunk, deriveKek, encryptBytes, generateDataKey,
  generateRecoveryCode, normalizeRecoveryCode, randomBytes, TamperedError, unwrapDataKey, wrapDataKey, WrongKeyError,
} from '../src/crypto';
import { WebNoDeviceKey } from '../src/device-key';

beforeAll(() => __setKdfParamsForTest({ memoryKiB: 1024 }));

const same = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b));

function bytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = (i * 31 + 7) & 0xff;
  return b;
}

describe('chunked AES-GCM', () => {
  it.each([0, 10, CHUNK_SIZE * 2 + 5])('round-trips %i bytes', async (n) => {
    const key = await generateDataKey();
    const plain = bytes(n);
    expect(same(await decryptBytes(key, await encryptBytes(key, plain)), plain)).toBe(true);
  });

  it('decrypts a single chunk', async () => {
    const key = await generateDataKey();
    const plain = bytes(CHUNK_SIZE * 2 + 5);
    const enc = await encryptBytes(key, plain);
    expect(same(await decryptChunk(key, enc, 2), plain.slice(CHUNK_SIZE * 2))).toBe(true);
  });

  it('detects a flipped ciphertext byte', async () => {
    const key = await generateDataKey();
    const enc = await encryptBytes(key, bytes(100));
    enc[enc.length - 20] ^= 1;
    await expect(decryptBytes(key, enc)).rejects.toBeInstanceOf(TamperedError);
  });

  it('detects swapped chunks', async () => {
    const key = await generateDataKey();
    const enc = await encryptBytes(key, bytes(CHUNK_SIZE * 2));
    const header = 20;
    const len = 12 + CHUNK_SIZE + 16;
    const swapped = new Uint8Array(enc);
    swapped.set(enc.subarray(header + len, header + 2 * len), header);
    swapped.set(enc.subarray(header, header + len), header + len);
    await expect(decryptBytes(key, swapped)).rejects.toBeInstanceOf(TamperedError);
  });

  it('rejects data with a wrong key', async () => {
    const enc = await encryptBytes(await generateDataKey(), bytes(10));
    await expect(decryptBytes(await generateDataKey(), enc)).rejects.toBeInstanceOf(TamperedError);
  });
});

describe('key wrapping', () => {
  it('unwraps with a kek derived from the same secret and salt', async () => {
    const salt = randomBytes(16);
    const dataKey = await generateDataKey();
    const wrapped = await wrapDataKey(dataKey, await deriveKek('correct horse', salt));
    const back = await unwrapDataKey(wrapped, await deriveKek('correct horse', salt));
    const enc = await encryptBytes(dataKey, bytes(50));
    expect(await decryptBytes(back, enc)).toEqual(bytes(50));
  });

  it('throws WrongKeyError for a wrong secret', async () => {
    const salt = randomBytes(16);
    const wrapped = await wrapDataKey(await generateDataKey(), await deriveKek('right', salt));
    await expect(unwrapDataKey(wrapped, await deriveKek('wrong', salt))).rejects.toBeInstanceOf(WrongKeyError);
  });
});

describe('recovery code', () => {
  it('has 6 groups of 4 Crockford base32 chars', () => {
    expect(generateRecoveryCode()).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){5}[0-9A-HJKMNP-TV-Z]{4}$/);
  });
  it('is random', () => {
    expect(generateRecoveryCode()).not.toBe(generateRecoveryCode());
  });
  it('normalizes user input', () => {
    expect(normalizeRecoveryCode('abcd-efgh ijkl-mnop-qrst-vwxy')).toBe('ABCDEFGH1JK1MN0PQRSTVWXY');
  });
});

describe('WebNoDeviceKey', () => {
  it('is unavailable and identity', async () => {
    expect(WebNoDeviceKey.available).toBe(false);
    expect(await WebNoDeviceKey.unwrap(await WebNoDeviceKey.wrap(bytes(5)))).toEqual(bytes(5));
  });
});
