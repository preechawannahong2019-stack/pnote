import { fireEvent, render, screen } from '@testing-library/svelte';
import { MemoryAdapter } from '@pnote/storage/adapter';
import { __setKdfParamsForTest } from '@pnote/storage/crypto';
import { DeviceKeyMissing, type DeviceKeyProvider } from '@pnote/storage/device-key';
import { ProfileService } from '@pnote/storage/profiles';
import PinPad from '../src/components/PinPad.svelte';
import CreateProfile from '../src/screens/CreateProfile.svelte';
import Unlock from '../src/screens/Unlock.svelte';

beforeAll(() => __setKdfParamsForTest({ memoryKiB: 1024 }));

function device(): DeviceKeyProvider & { lost: boolean } {
  const d = { available: true, lost: false, wrap: async (b: Uint8Array) => b, unwrap: async (b: Uint8Array) => { if (d.lost) throw new DeviceKeyMissing(); return b; } };
  return d;
}

async function tap(digits: string) {
  for (const d of digits) await fireEvent.click(screen.getByRole('button', { name: d }));
}
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('PinPad', () => {
  it('calls onComplete once with 6 digits', async () => {
    const onComplete = vi.fn();
    render(PinPad, { length: 6, label: 'ใส่ PIN 6 หลัก', onComplete });
    await tap('1234567');
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith('123456');
  });
  it('deletes the last digit', async () => {
    const onComplete = vi.fn();
    render(PinPad, { length: 6, label: 'x', onComplete });
    await tap('12345');
    await fireEvent.click(screen.getByRole('button', { name: 'ลบ' }));
    await tap('99');
    expect(onComplete).toHaveBeenCalledWith('123499');
  });
});

describe('PIN screens on native', () => {
  it('create asks for the PIN twice and rejects a mismatch', async () => {
    const service = new ProfileService(new MemoryAdapter(), device());
    render(CreateProfile, { service, pin: true, onDone: () => {}, onCancel: () => {} });
    await fireEvent.input(screen.getByLabelText('ชื่อ', { exact: true }), { target: { value: 'A' } });
    await fireEvent.click(screen.getByRole('button', { name: 'ถัดไป' }));
    await tap('123456');
    await tap('654321');
    expect(await screen.findByText('PIN ไม่ตรงกัน')).toBeInTheDocument();
    expect(await service.list()).toEqual([]);
  });

  it('create with matching PINs shows the recovery code', async () => {
    const service = new ProfileService(new MemoryAdapter(), device());
    render(CreateProfile, { service, pin: true, onDone: () => {}, onCancel: () => {} });
    await fireEvent.input(screen.getByLabelText('ชื่อ', { exact: true }), { target: { value: 'A' } });
    await fireEvent.click(screen.getByRole('button', { name: 'ถัดไป' }));
    await tap('123456');
    await tap('123456');
    expect(await screen.findByTestId('recovery-code')).toBeInTheDocument();
  });

  it('unlock with a wrong PIN shows attempts left and clears the pad', async () => {
    const d = device();
    const service = new ProfileService(new MemoryAdapter(), d);
    const { profile } = await service.create('A', '123456', '#000');
    render(Unlock, { service, profile, pin: true, onUnlocked: () => {}, onRecover: () => {}, onBack: () => {} });
    await tap('111111');
    expect(await screen.findByText('PIN ไม่ถูกต้อง เหลือ 9 ครั้ง')).toBeInTheDocument();
    expect(screen.getByTestId('pin-dots').querySelectorAll('.filled')).toHaveLength(0);
  });

  it('unlock shows the device-key-missing message with a recovery button', async () => {
    const d = device();
    const service = new ProfileService(new MemoryAdapter(), d);
    const { profile } = await service.create('A', '123456', '#000');
    d.lost = true;
    const onRecover = vi.fn();
    render(Unlock, { service, profile, pin: true, onUnlocked: () => {}, onRecover, onBack: () => {} });
    await tap('123456');
    await settle();
    expect(await screen.findByText('ไม่พบกุญแจของเครื่องนี้ ใช้รหัสกู้คืนเพื่อเปิดโปรไฟล์')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'ใช้รหัสกู้คืน' }));
    expect(onRecover).toHaveBeenCalled();
  });

  it('web keeps the password form', () => {
    const service = new ProfileService(new MemoryAdapter(), { available: false, wrap: async (b) => b, unwrap: async (b) => b });
    render(CreateProfile, { service, onDone: () => {}, onCancel: () => {} });
    expect(screen.getByLabelText('รหัสผ่าน', { exact: true })).toBeInTheDocument();
  });
});
