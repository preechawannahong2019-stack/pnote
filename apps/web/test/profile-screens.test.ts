import { fireEvent, render, screen } from '@testing-library/svelte';
import { MemoryAdapter } from '@pnote/storage/adapter';
import { __setKdfParamsForTest } from '@pnote/storage/crypto';
import { WebNoDeviceKey } from '@pnote/storage/device-key';
import { ProfileService } from '@pnote/storage/profiles';
import CreateProfile from '../src/screens/CreateProfile.svelte';
import Unlock from '../src/screens/Unlock.svelte';
import SecurityBanner from '../src/components/SecurityBanner.svelte';
import App from '../src/App.svelte';

beforeAll(() => __setKdfParamsForTest({ memoryKiB: 1024 }));

async function fill(label: string, value: string) {
  await fireEvent.input(screen.getByLabelText(label), { target: { value } });
}

describe('CreateProfile', () => {
  it('shows the recovery code and keeps Continue disabled until confirmed', async () => {
    const service = new ProfileService(new MemoryAdapter(), WebNoDeviceKey);
    const onDone = vi.fn();
    render(CreateProfile, { service, onDone, onCancel: () => {} });
    await fill('ชื่อ', 'สมชาย');
    await fill('รหัสผ่าน', 'password-123');
    await fill('ยืนยันรหัสผ่าน', 'password-123');
    await fireEvent.click(screen.getByRole('button', { name: 'สร้างโปรไฟล์' }));
    expect(await screen.findByTestId('recovery-code')).toHaveTextContent(/^([0-9A-Z]{4}-){5}[0-9A-Z]{4}$/);
    expect(screen.getByText('ถ้าลืมรหัสผ่านและรหัสกู้คืน จะไม่สามารถเปิดข้อมูลในโปรไฟล์นี้ได้อีก')).toBeInTheDocument();
    const cont = screen.getByRole('button', { name: 'ดำเนินการต่อ' });
    expect(cont).toBeDisabled();
    await fireEvent.click(screen.getByLabelText('ฉันจดรหัสกู้คืนเก็บไว้แล้ว'));
    expect(cont).toBeEnabled();
    await fireEvent.click(cont);
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ name: 'สมชาย' }));
  });

  it('rejects a 7-character password without creating', async () => {
    const service = new ProfileService(new MemoryAdapter(), WebNoDeviceKey);
    render(CreateProfile, { service, onDone: () => {}, onCancel: () => {} });
    await fill('ชื่อ', 'A');
    await fill('รหัสผ่าน', '1234567');
    await fill('ยืนยันรหัสผ่าน', '1234567');
    await fireEvent.click(screen.getByRole('button', { name: 'สร้างโปรไฟล์' }));
    expect(await screen.findByText('รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร')).toBeInTheDocument();
    expect(await service.list()).toEqual([]);
  });

  it('rejects mismatched passwords', async () => {
    const service = new ProfileService(new MemoryAdapter(), WebNoDeviceKey);
    render(CreateProfile, { service, onDone: () => {}, onCancel: () => {} });
    await fill('ชื่อ', 'A');
    await fill('รหัสผ่าน', 'password-123');
    await fill('ยืนยันรหัสผ่าน', 'password-124');
    await fireEvent.click(screen.getByRole('button', { name: 'สร้างโปรไฟล์' }));
    expect(await screen.findByText('รหัสผ่านไม่ตรงกัน')).toBeInTheDocument();
  });
});

describe('Unlock', () => {
  async function setup() {
    let t = 1_000_000;
    const clock = { now: () => t, advance: (ms: number) => { t += ms; } };
    const service = new ProfileService(new MemoryAdapter(), WebNoDeviceKey, clock.now);
    const { profile } = await service.create('A', 'password-123', '#000');
    const onUnlocked = vi.fn();
    const onRecover = vi.fn();
    render(Unlock, { service, profile, onUnlocked, onRecover, onBack: () => {} });
    const attempt = async (pw: string) => {
      await fill('รหัสผ่าน', pw);
      await fireEvent.click(screen.getByRole('button', { name: 'ปลดล็อก' }));
      await new Promise((r) => setTimeout(r, 0));
      await vi.waitFor(() => {
        const b = screen.queryByRole('button', { name: 'ปลดล็อก' });
        expect(b === null || !(b as HTMLButtonElement).disabled).toBe(true);
      });
    };
    return { attempt, onUnlocked, onRecover, clock };
  }

  it('shows attempts left on a wrong password', async () => {
    const { attempt } = await setup();
    await attempt('nope-nope');
    expect(await screen.findByText('รหัสผ่านไม่ถูกต้อง เหลือ 9 ครั้ง')).toBeInTheDocument();
  });

  it('shows the delay countdown', async () => {
    const { attempt } = await setup();
    for (let i = 0; i < 5; i++) await attempt('nope-nope');
    await attempt('password-123');
    expect(await screen.findByText('ใส่รหัสผิดหลายครั้ง ลองใหม่ได้ใน 30 วินาที')).toBeInTheDocument();
  });

  it('shows the locked message and a link to recovery', async () => {
    const { attempt, onRecover, clock } = await setup();
    for (let i = 0; i < 10; i++) { await attempt('nope-nope'); clock.advance(1_000_000); }
    expect(await screen.findByText('โปรไฟล์ถูกล็อก ใช้รหัสกู้คืนเพื่อปลดล็อก')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'ใช้รหัสกู้คืน' }));
    expect(onRecover).toHaveBeenCalled();
  });

  it('calls onUnlocked with the right password', async () => {
    const { attempt, onUnlocked } = await setup();
    await attempt('password-123');
    await vi.waitFor(() => expect(onUnlocked).toHaveBeenCalledWith(expect.objectContaining({ ok: true })));
  });
});

describe('SecurityBanner and App', () => {
  it('shows the web warning when there is no device key', () => {
    render(SecurityBanner, { device: WebNoDeviceKey });
    expect(screen.getByText('เวอร์ชันเว็บ ความปลอดภัยต่ำกว่าแอปติดตั้ง')).toBeInTheDocument();
  });

  it('App shows the banner and the profile picker', async () => {
    render(App, { adapter: new MemoryAdapter(), device: WebNoDeviceKey });
    expect(screen.getByText('เวอร์ชันเว็บ ความปลอดภัยต่ำกว่าแอปติดตั้ง')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'สร้างโปรไฟล์ใหม่' })).toBeInTheDocument();
  });
});
