import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { createProfileAndUnlock, unlock } from './helpers';

const FIX = new URL('./.fixtures/', import.meta.url).pathname;
test.setTimeout(180_000);

async function nonWhite(page: Page): Promise<number> {
  return page.evaluate(() => {
    const c = document.querySelector('[data-testid="canvas-host"] canvas') as HTMLCanvasElement;
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 16) if (d[i] < 200 && d[i + 3] > 0) n++;
    return n;
  });
}

async function importFile(page: Page, file: { name: string; mimeType: string; buffer: Buffer }) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '⤓ นำเข้าไฟล์', exact: true }).click();
  await (await chooser).setFiles(file);
}

async function textPng(page: Page, text: string): Promise<Buffer> {
  const b64 = await page.evaluate((t) => {
    const c = document.createElement('canvas');
    c.width = 1200; c.height = 400;
    const x = c.getContext('2d')!;
    x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
    x.fillStyle = '#000'; x.font = 'bold 96px sans-serif'; x.fillText(t, 60, 230);
    return c.toDataURL('image/png').split(',')[1];
  }, text);
  return Buffer.from(b64, 'base64');
}

test('import a PDF, write on it, find it, export it, use it offline', async ({ page, context }) => {
  await createProfileAndUnlock(page, 'พีดีเอฟ');

  await importFile(page, { name: 'not-a-pdf.pdf', mimeType: 'application/pdf', buffer: readFileSync(`${FIX}not-a-pdf.pdf`) });
  await expect(page.getByText('ไฟล์นี้ไม่ใช่ PDF')).toBeVisible();

  await importFile(page, { name: 'fixture.pdf', mimeType: 'application/pdf', buffer: readFileSync(`${FIX}plain.pdf`) });
  await expect(page.getByTestId('toolbar')).toBeVisible();
  await expect.poll(() => nonWhite(page), { timeout: 20_000 }).toBeGreaterThan(50); // PDF text rendered

  const box = (await page.getByTestId('canvas-host').boundingBox())!;
  await page.mouse.move(box.x + 200, box.y + 400);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + 200 + i * 10, box.y + 400);
  await page.mouse.up();

  await page.getByRole('button', { name: 'กล่องข้อความ' }).click();
  await page.mouse.click(box.x + 150, box.y + 500);
  await page.getByLabel('ข้อความ', { exact: true }).fill('ทดสอบข้อความ');
  await page.getByRole('button', { name: 'เสร็จ' }).click();

  const downloadP = page.waitForEvent('download');
  await page.getByRole('button', { name: 'ส่งออก' }).click();
  await expect(page.getByText('ไฟล์ PDF ที่ส่งออกไม่ได้เข้ารหัส ผู้ที่ได้รับไฟล์จะเปิดอ่านได้ทันที')).toBeVisible();
  await page.getByRole('button', { name: 'ดาวน์โหลด' }).click();
  const download = await downloadP;
  expect(download.suggestedFilename()).toMatch(/^fixture_\d{4}-\d{2}-\d{2}\.pdf$/);
  const exported = await PDFDocument.load(readFileSync((await download.path())!));
  expect(exported.getPageCount()).toBe(4);

  await page.getByRole('button', { name: 'กลับ' }).click();
  await page.getByLabel('ค้นหาชื่อเอกสาร').fill('EVIDENCE');
  await expect(page.getByRole('button', { name: /หน้า 2/ })).toBeVisible({ timeout: 30_000 });
  await page.getByLabel('ค้นหาชื่อเอกสาร').fill('');

  // a scanned image goes through on-device OCR (Tesseract)
  await importFile(page, { name: 'scan.png', mimeType: 'image/png', buffer: await textPng(page, 'CASE 7788') });
  await expect(page.getByTestId('toolbar')).toBeVisible();
  const chip = page.getByRole('status').filter({ hasText: 'กำลังอ่านข้อความ' });
  await expect(chip).toBeVisible({ timeout: 20_000 });
  await expect(chip).toBeHidden({ timeout: 90_000 });
  await page.getByRole('button', { name: 'กลับ' }).click();
  await page.getByLabel('ค้นหาชื่อเอกสาร').fill('7788');
  await expect(page.getByRole('button', { name: /หน้า 1/ })).toBeVisible({ timeout: 30_000 });
  await page.getByLabel('ค้นหาชื่อเอกสาร').fill('');

  await context.setOffline(true);
  await page.reload();
  await page.getByRole('button', { name: /พีดีเอฟ/ }).click();
  await unlock(page);
  await page.getByRole('button', { name: 'เปิด fixture' }).click();
  await expect.poll(() => nonWhite(page), { timeout: 20_000 }).toBeGreaterThan(50);
});
