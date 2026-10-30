import { expect, test } from '@playwright/test';

test('public landing page loads', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Barber\+\+/);
  await expect(page.locator('#root')).not.toBeEmpty();
});


test('landing describes the current web product in both languages on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  for (const language of ['en', 'ar']) {
    await page.evaluate((lang) => localStorage.setItem('barber-language', lang), language);
    await page.reload();
    await expect(page.locator('.booking-preview')).toBeVisible();
    await expect(page.locator('body')).not.toContainText(/whatsapp|واتساب/i);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  }
});
