import { test, expect } from './fixtures.js';
import fs from 'node:fs';
const state = JSON.parse(fs.readFileSync(new URL('../../../.cloud-test/credentials.json', import.meta.url)));
const engine = process.env.CLOUD_TEST_BROWSER || 'chromium';
test.use({ browserName: engine });

test('customer and team sign-in share controls and theme styling in English and Arabic', async ({ page }) => {
  for (const language of ['en', 'ar']) {
    await page.addInitScript(language => localStorage.setItem('barber-language', language), language);
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      for (const route of ['/customer/sign-in', '/login']) {
        await page.goto(route);
        await expect(page.locator('.ca-panel')).toBeVisible();
        await expect(page.locator('.ca-social-apple')).toBeEnabled();
        await expect(page.locator('.ca-password')).toBeVisible();
        await expect(page.locator('input[type="email"]')).toHaveAttribute('autocomplete', 'email');
        await expect(page.locator('input[type="password"]')).toHaveAttribute('autocomplete', 'current-password');
        for (const theme of ['light', 'dark']) {
          if (await page.locator('html').getAttribute('data-theme') !== theme) await page.getByRole('button', { name: /Switch to .* mode|التبديل إلى/ }).click();
          await expect(page.locator('.ca-social-apple')).toHaveCSS('background-color', theme === 'dark' ? 'rgb(255, 255, 255)' : 'rgb(0, 0, 0)');
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
          if (width === 390) await page.screenshot({ path: `.cloud-test/unified-signin-${engine}-${route === '/login' ? 'team' : 'customer'}-${language}-${theme}.png` });
        }
      }
    }
  }
});

test('team OAuth cancellation and unsolicited callbacks never enter a workspace', async ({ page }) => {
  await page.goto('/team/auth-callback?error=access_denied');
  await expect(page.locator('.ca-main [role="alert"]')).toBeVisible();
  expect(new URL(page.url()).search).toBe('');
  await page.goto('/team/auth-callback?code=not-a-started-transaction');
  await expect(page.locator('.ca-main [role="alert"]')).toBeVisible();
  await expect(page.locator('.ca-main').getByRole('link', { name: 'Back to team sign in', exact: true })).toHaveAttribute('href', '/login');
  await page.goto('/dashboard'); await expect(page).toHaveURL(/\/login$/);
});

test('manager settings expose provider connections without affecting another shop or customer session', async ({ page }) => {
  await page.goto('/login');
  await page.locator('#email').fill('manager@barber.test'); await page.locator('#password').fill(state.staffPassword);
  await page.locator('button[type="submit"]').click(); await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto('/dashboard/settings');
  await expect(page.getByRole('heading', { name: 'Google & Apple sign-in', exact: true })).toBeVisible();
  await expect(page.locator('.ca-manager-social .ca-social-google')).toBeEnabled();
  await expect(page.locator('.ca-manager-social .ca-social-apple')).toBeEnabled();
  await expect(page.locator('.ca-manager-social')).toContainText('same shops and access');
  await page.screenshot({ path: `.cloud-test/manager-provider-connections-${engine}.png`, fullPage: true });
});

test('an expired manager connection returns to Settings instead of ordinary sign-in', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('barber-team-oauth-pending', JSON.stringify({ provider: 'google', linking: true, managerId: '00000000-0000-4000-8000-000000000002', startedAt: Date.now() - 6 * 60000 })));
  await page.goto('/team/auth-callback?error=access_denied&error_code=bad_oauth_state');
  await expect(page.locator('.ca-main [role="alert"]')).toContainText('connection expired or was not completed');
  await expect(page.locator('.ca-main').getByRole('link', { name: 'Back to manager Settings', exact: true })).toHaveAttribute('href', '/dashboard/settings');
  await expect(page.locator('.ca-main').getByRole('link', { name: 'Back to team sign in', exact: true })).toHaveCount(0);
  await page.screenshot({ path: '.cloud-test/manager-link-expired.png' });
});
