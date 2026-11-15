import { expect, test } from '@playwright/test';
import { createProfileAndUnlock, darkPixels, newNotebook, unlock } from './helpers';

test('a drawn stroke survives reload, and the toolbar collapse is remembered', async ({ page }) => {
  await createProfileAndUnlock(page);
  await newNotebook(page, 'สมุดทดสอบ');
  const box = (await page.getByTestId('canvas-host').boundingBox())!;
  const y = box.y + 300;
  expect(await darkPixels(page, box.x + 150, y - 10, 200, 20)).toBe(0);
  await page.mouse.move(box.x + 150, y);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) await page.mouse.move(box.x + 150 + i * 10, y);
  await page.mouse.up();
  await expect.poll(() => darkPixels(page, box.x + 150, y - 10, 200, 20)).toBeGreaterThan(20);

  await page.getByRole('button', { name: 'ย่อแถบเครื่องมือ' }).click();
  await expect(page.getByTestId('toolbar').getByRole('button')).toHaveCount(1);

  await page.waitForTimeout(800); // autosave debounce
  await page.reload();
  await page.getByRole('button', { name: /ทดสอบ/ }).click();
  await unlock(page);
  await page.getByRole('button', { name: 'เปิด สมุดทดสอบ' }).click();
  await expect(page.getByTestId('toolbar').getByRole('button')).toHaveCount(1);
  await expect.poll(() => darkPixels(page, box.x + 150, y - 10, 200, 20)).toBeGreaterThan(20);
});
