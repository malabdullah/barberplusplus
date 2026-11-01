import { test, expect } from './fixtures.js';
const engine = process.env.CLOUD_TEST_BROWSER || 'chromium';
test.use({ browserName: engine });

test('Apple sign-in remains visible and reverses its artwork with the website theme', async ({ page }) => {
  for (const language of ['en', 'ar']) {
    await page.addInitScript(language => localStorage.setItem('barber-language', language), language);
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      for (const route of ['sign-in', 'sign-up']) {
        await page.goto(`/customer/${route}`);
        const button = page.locator('.ca-social-apple');
        await expect(button).toBeEnabled();
        for (const appearance of ['dark', 'light', 'dark']) {
          if (await page.locator('html').getAttribute('data-theme') !== appearance) await page.getByRole('button', { name: /Switch to .* mode|التبديل إلى/ }).click();
          await expect(page.locator('html')).toHaveAttribute('data-theme', appearance);
          await expect(button).toHaveCSS('background-color', appearance === 'dark' ? 'rgb(255, 255, 255)' : 'rgb(0, 0, 0)');
          await expect(button).toHaveCSS('color', appearance === 'dark' ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 255)');
          await expect(button.locator('svg')).toHaveCSS('fill', appearance === 'dark' ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 255)');
          await expect(button).toHaveAccessibleName(language === 'ar' ? 'المتابعة باستخدام Apple' : 'Continue with Apple');
          const bounds = await button.boundingBox(); expect(bounds.height).toBeGreaterThanOrEqual(44);
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        }
        if (width === 390 && route === 'sign-in') await page.screenshot({ path: `.cloud-test/apple-button-${engine}-${language}-dark.png` });
      }
    }
  }
});
