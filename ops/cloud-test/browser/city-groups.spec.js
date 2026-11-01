import { test, expect } from './fixtures.js';

test.use({ browserName: process.env.CLOUD_TEST_BROWSER || 'chromium' });

for (const language of ['en', 'ar']) {
  for (const theme of ['dark', 'light']) {
    test(`city groups are readable and selectable in ${language}, ${theme}`, async ({ page }) => {
      await page.addInitScript(({ language, theme }) => {
        localStorage.setItem('barber-language', language);
        localStorage.setItem('barber-theme', theme);
        sessionStorage.removeItem('barber-customer-booking-draft');
      }, { language, theme });
      for (const width of [360, 1280]) {
        await page.setViewportSize({ width, height: 844 });
        const catalogResponse = page.waitForResponse(response => response.url().includes('customer-booking') && response.request().postDataJSON()?.action === 'catalog');
        await page.goto('/book');
        const catalog = await (await catalogResponse).json();
        const city = page.locator('#booking-city');
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await expect(city.locator('optgroup')).toHaveCount(2);
        await expect(city.locator('optgroup').nth(0)).toHaveAttribute('label', language === 'ar' ? 'العاصمة' : 'Al Asimah (Capital)');
        await expect(city.locator('optgroup').nth(1)).toHaveAttribute('label', language === 'ar' ? 'حولي' : 'Hawalli');
        expect(await city.locator('optgroup option').evaluateAll(options => options.map(option => option.value))).toEqual(['Kuwait City', 'Salmiya']);
        const styles = await city.evaluate(select => [select, ...select.querySelectorAll('option, optgroup')].map(element => {
          const style = getComputedStyle(element);
          const rgb = value => value.match(/[\d.]+/g).slice(0, 3).map(Number);
          const luminance = color => rgb(color).map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
          const light = luminance(style.color), dark = luminance(style.backgroundColor);
          return { scheme: style.colorScheme, background: style.backgroundColor, contrast: (Math.max(light, dark) + .05) / (Math.min(light, dark) + .05) };
        }));
        for (const style of styles) {
          expect(style.scheme).toBe(theme);
          expect(style.background).not.toBe('rgba(0, 0, 0, 0)');
          expect(style.contrast).toBeGreaterThanOrEqual(4.5);
        }
        await city.focus();
        expect(await page.locator('.cb-select-wrap').evaluate(element => getComputedStyle(element).outlineStyle)).toBe('solid');
        await city.selectOption('Salmiya');
        await expect(page.locator('#choose-shop')).toHaveClass(/is-open/);
        const visibleShops = await page.locator('#choose-shop input[name="branch"]').evaluateAll(inputs => inputs.map(input => input.value).sort());
        expect(visibleShops).toEqual(catalog.branches.filter(branch => branch.city === 'Salmiya').map(branch => branch.id).sort());
        expect(visibleShops.length).toBeGreaterThan(0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      }
    });
  }
}
