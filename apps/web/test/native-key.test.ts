import { DeviceKeyMissing } from '@pnote/storage/device-key';
import { NativeDeviceKey, type PnoteSecure } from '../src/platform/native-key';

function fakePlugin(): PnoteSecure & { fail?: string } {
  const p: PnoteSecure & { fail?: string } = {
    status: async () => ({ available: true, hardware: 'tee' }),
    wrap: async ({ data }) => ({ data: btoa(atob(data).split('').reverse().join('')) }),
    unwrap: async ({ data }) => {
      if (p.fail) throw Object.assign(new Error('native'), { code: p.fail });
      return { data: btoa(atob(data).split('').reverse().join('')) };
    },
    excludeFromBackup: async () => {},
  };
  return p;
}

describe('NativeDeviceKey', () => {
  it.each([0, 1, 4096])('round-trips %i bytes through the plugin', async (n) => {
    const k = await NativeDeviceKey.create(fakePlugin());
    const b = Uint8Array.from({ length: n }, (_, i) => (i * 37) & 255);
    expect(k.available).toBe(true);
    expect(await k.unwrap(await k.wrap(b))).toEqual(b);
  });
  it.each(['KEY_MISSING', 'KEY_INVALID'])('maps %s to DeviceKeyMissing', async (code) => {
    const p = fakePlugin();
    const k = await NativeDeviceKey.create(p);
    const w = await k.wrap(new Uint8Array([1, 2]));
    p.fail = code;
    await expect(k.unwrap(w)).rejects.toBeInstanceOf(DeviceKeyMissing);
  });
  it('passes other failures through', async () => {
    const p = fakePlugin();
    const k = await NativeDeviceKey.create(p);
    p.fail = 'DECRYPT_FAILED';
    await expect(k.unwrap(new Uint8Array([1]))).rejects.not.toBeInstanceOf(DeviceKeyMissing);
  });
  it('is unavailable when the plugin says so', async () => {
    const p = fakePlugin();
    p.status = async () => ({ available: false, hardware: 'keychain' });
    expect((await NativeDeviceKey.create(p)).available).toBe(false);
  });
});
