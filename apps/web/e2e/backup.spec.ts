import { expect, test } from '@playwright/test';
import { createProfileAndUnlock, darkPixels, newNotebook, PW } from './helpers';

const BACKUP_PW = 'backup-password-1';

test('a notebook exported as .pnote restores into a new profile in a fresh browser', async ({ page, browser }) => {
  await createProfileAndUnlock(page, 'ต้นทาง');
  await newNotebook(page, 'backup-notebook');
  const box = (await page.getByTestId('canvas-host').boundingBox())!;
  const y = box.y + 300;
  await page.mouse.move(box.x + 150, y);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) await page.mouse.move(box.x + 150 + i * 10, y);
  await page.mouse.up();
  await expect.poll(() => darkPixels(page, box.x + 150, y - 10, 200, 20)).toBeGreaterThan(20);
  await page.waitForTimeout(800); // autosave debounce (ASCII title: headless Chrome here names non-ASCII downloads "download")
  await page.getByRole('button', { name: 'กลับ', exact: true }).first().click();

  await page.getByRole('button', { name: 'ส่งออก backup-notebook เป็น .pnote' }).click();
  await page.getByLabel('รหัสผ่านไฟล์สำรอง (อย่างน้อย 10 ตัวอักษร)').fill('short');
  await page.getByLabel('ยืนยันรหัสผ่านไฟล์สำรอง').fill('short');
  await page.getByRole('button', { name: 'บันทึกไฟล์' }).click();
  await expect(page.getByRole('alert')).toContainText('อย่างน้อย 10 ตัวอักษร');
  await page.getByLabel('รหัสผ่านไฟล์สำรอง (อย่างน้อย 10 ตัวอักษร)').fill(BACKUP_PW);
  await page.getByLabel('ยืนยันรหัสผ่านไฟล์สำรอง').fill(BACKUP_PW);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'บันทึกไฟล์' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^backup-notebook_\d{4}-\d{2}-\d{2}\.pnote$/);
  const file = await download.path();

  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  await p2.goto('/');
  await p2.getByRole('button', { name: 'กู้คืนโปรไฟล์จากไฟล์สำรอง' }).click();
  await p2.getByLabel('ไฟล์สำรอง (.pnote)').setInputFiles(file);
  await p2.getByLabel('รหัสผ่านไฟล์สำรอง').fill('wrong-password-0');
  await p2.getByRole('button', { name: 'ถัดไป' }).click();
  await expect(p2.getByRole('alert')).toContainText('รหัสผ่านไฟล์สำรองไม่ถูกต้อง');
  await p2.getByLabel('รหัสผ่านไฟล์สำรอง').fill(BACKUP_PW);
  await p2.getByRole('button', { name: 'ถัดไป' }).click();
  await p2.getByLabel('ชื่อ', { exact: true }).fill('ปลายทาง');
  await p2.getByLabel('รหัสผ่าน', { exact: true }).fill(PW);
  await p2.getByLabel('ยืนยันรหัสผ่าน').fill(PW);
  await p2.getByRole('button', { name: 'สร้างโปรไฟล์' }).click();
  await p2.getByLabel('ฉันจดรหัสกู้คืนเก็บไว้แล้ว').check();
  await p2.getByRole('button', { name: 'ดำเนินการต่อ' }).click();
  await p2.getByLabel('รหัสผ่าน', { exact: true }).fill(PW);
  await p2.getByRole('button', { name: 'ปลดล็อก' }).click();
  await p2.getByRole('button', { name: 'เปิด backup-notebook' }).click();
  const b2 = (await p2.getByTestId('canvas-host').boundingBox())!;
  await expect.poll(() => darkPixels(p2, b2.x + 150, b2.y + 290, 200, 20)).toBeGreaterThan(20);
  await ctx.close();
});
