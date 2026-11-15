import { expect, test } from '@playwright/test';
import { createProfileAndUnlock, newNotebook, unlock } from './helpers';

test('works offline after the first visit and never calls another origin', async ({ page, context, baseURL }) => {
  const origins = new Set<string>();
  page.on('request', (r) => origins.add(new URL(r.url()).origin));

  await page.goto('/');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await createProfileAndUnlock(page, 'ออฟไลน์');
  await newNotebook(page, 'สมุดออฟไลน์');
  await page.getByRole('button', { name: 'กลับ' }).click();

  await context.setOffline(true);
  await page.reload();
  await page.getByRole('button', { name: /ออฟไลน์/ }).click();
  await unlock(page);
  await page.getByRole('button', { name: 'เปิด สมุดออฟไลน์' }).click();
  await expect(page.getByTestId('canvas-host')).toBeVisible();

  const own = new URL(baseURL!).origin;
  expect([...origins].filter((o) => o !== own && !o.startsWith('blob:') && o !== 'null')).toEqual([]);
});
