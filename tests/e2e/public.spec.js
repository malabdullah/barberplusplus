import { expect, test } from '@playwright/test';

test('public landing page loads', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Barber\+\+/);
  await expect(page.locator('#root')).not.toBeEmpty();
});

