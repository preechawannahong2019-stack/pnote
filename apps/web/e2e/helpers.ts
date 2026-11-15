import { expect, type Page } from '@playwright/test';

export const PW = 'password-123';

export async function createProfileAndUnlock(page: Page, name = 'ทดสอบ') {
  await page.goto('/');
  await page.getByRole('button', { name: 'สร้างโปรไฟล์ใหม่' }).click();
  await page.getByLabel('ชื่อ', { exact: true }).fill(name);
  await page.getByLabel('รหัสผ่าน', { exact: true }).fill(PW);
  await page.getByLabel('ยืนยันรหัสผ่าน').fill(PW);
  await page.getByRole('button', { name: 'สร้างโปรไฟล์' }).click();
  await page.getByLabel('ฉันจดรหัสกู้คืนเก็บไว้แล้ว').check();
  await page.getByRole('button', { name: 'ดำเนินการต่อ' }).click();
  await unlock(page);
}

export async function unlock(page: Page) {
  await page.getByLabel('รหัสผ่าน', { exact: true }).fill(PW);
  await page.getByRole('button', { name: 'ปลดล็อก' }).click();
  await expect(page.getByRole('button', { name: '＋ สมุดใหม่' })).toBeVisible();
}

export async function newNotebook(page: Page, title: string, template = 'lined') {
  await page.getByRole('button', { name: '＋ สมุดใหม่' }).click();
  await page.getByLabel('ชื่อ', { exact: true }).fill(title);
  await page.getByLabel('กระดาษ').selectOption(template);
  await page.getByRole('button', { name: 'สร้าง', exact: true }).click();
  await expect(page.getByTestId('canvas-host')).toBeVisible();
}

/** Count dark pixels in a region of the ink canvas. */
export async function darkPixels(page: Page, x: number, y: number, w: number, h: number): Promise<number> {
  return page.evaluate(([x, y, w, h]) => {
    const c = document.querySelector('[data-testid="canvas-host"] canvas') as HTMLCanvasElement;
    const dpr = window.devicePixelRatio || 1;
    const host = c.parentElement!.getBoundingClientRect();
    const d = c.getContext('2d')!.getImageData((x - host.left) * dpr, (y - host.top) * dpr, w * dpr, h * dpr).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 100 && d[i + 1] < 100 && d[i + 2] < 100 && d[i + 3] > 0) n++;
    return n;
  }, [x, y, w, h]);
}
