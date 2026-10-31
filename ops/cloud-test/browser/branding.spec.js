import { test, expect } from '@playwright/test';
import path from 'node:path';

for (const width of [1440, 390]) {
  for (const theme of ['light', 'dark']) {
    for (const language of ['en', 'ar']) {
      test(`public branding: ${width}px, ${theme}, ${language}`, async ({ page }) => {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
        await page.addInitScript(({ theme, language }) => {
          localStorage.setItem('barber-theme', theme);
          localStorage.setItem('barber-language', language);
        }, { theme, language });
        for (const [name, route] of [['landing', '/'], ['login', '/login'], ['booking', '/book'], ['customer', '/customer/sign-in']]) {
          await page.goto(route);
          await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
          await expect(page.locator('html')).toHaveAttribute('dir', language === 'ar' ? 'rtl' : 'ltr');
          const logo = page.locator('.brand-logo').first();
          await expect(logo).toBeVisible();
          const logoBox = await logo.boundingBox();
          const bannerBox = await page.locator('.environment-banner').boundingBox();
          expect(logoBox.y).toBeGreaterThanOrEqual(bannerBox.y + bannerBox.height);
          expect(await logo.evaluate(el => getComputedStyle(el).direction)).toBe('ltr');
          const treatment = name === 'booking' || name === 'customer' ? 'light' : theme;
          await expect(logo.locator(`.brand-logo-${treatment}`)).toBeVisible();
          await expect(logo.locator(`.brand-logo-${treatment === 'light' ? 'dark' : 'light'}`)).toBeHidden();
          await expect.poll(() => logo.locator(`.brand-logo-${treatment}`).evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
          if (name === 'booking') await expect(page.locator('#booking-city')).toBeVisible();
          if (name === 'customer') await expect(page.locator('#customer-auth-email')).toBeVisible();
          await page.screenshot({ path: path.resolve('.cloud-test', `brand-${name}-${width}-${theme}-${language}.png`) });
        }
      });
    }
  }
}

test('brand browser icons and additional authentication pages load', async ({ page, request }) => {
  for (const asset of ['/favicon.svg', '/favicon-16.png', '/favicon-32.png', '/favicon-48.png', '/apple-touch-icon.png', '/icon-192.png', '/icon-512.png', '/site.webmanifest']) {
    const response = await request.get(asset);
    expect(response.ok(), asset).toBe(true);
    expect(response.headers()['x-robots-tag']).toContain('noindex');
  }
  for (const route of ['/signup', '/forgot-password']) {
    await page.goto(route);
    await expect(page.locator('.login-logo .brand-logo')).toBeVisible();
  }
});
