import { test, expect } from './fixtures.js';

test.use({ browserName: process.env.CLOUD_TEST_BROWSER || 'chromium', hasTouch: true });

for (const language of ['en', 'ar']) {
  for (const theme of ['dark', 'light']) {
    test(`searchable city groups in ${language}, ${theme}`, async ({ page }) => {
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
        const city = page.getByRole('combobox', { name: language === 'ar' ? 'المدينة' : 'City', exact: true });
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await city.click();
        const menu = page.locator('.cb-city-menu');
        const capital = language === 'ar' ? 'العاصمة' : 'Al Asimah (Capital)';
        await expect(menu.getByRole('group')).toHaveCount(2);
        await expect(menu.getByRole('group').nth(0)).toHaveAttribute('aria-label', capital);
        await expect(menu.getByRole('group').nth(1)).toHaveAttribute('aria-label', language === 'ar' ? 'حولي' : 'Hawalli');
        expect(await menu.getByRole('option').evaluateAll(options => options.map(option => option.dataset.city))).toEqual(['Kuwait City', 'Salmiya']);
        await menu.getByText(capital, { exact: true }).click();
        await expect(city).toHaveAttribute('aria-expanded', 'true');
        await expect(page.locator('#booking-next')).toBeDisabled();
        const styles = await menu.evaluate(menu => [...menu.querySelectorAll('.cb-city-group-heading > span, .cb-city-group-heading > strong, .cb-city-option > span')].map(element => {
          const style = getComputedStyle(element);
          const rgb = value => value.match(/[\d.]+/g).map(Number);
          const surface = rgb(getComputedStyle(menu).backgroundColor);
          const fill = rgb(getComputedStyle(element.parentElement).backgroundColor);
          const alpha = fill.length > 3 ? fill[3] : 1;
          const background = fill.slice(0, 3).map((value, i) => alpha * value + (1 - alpha) * surface[i]);
          const luminance = color => color.map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
          const a = luminance(rgb(style.color).slice(0, 3)), b = luminance(background);
          return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
        }));
        for (const contrast of styles) expect(contrast).toBeGreaterThanOrEqual(4.5);
        for (const option of await menu.getByRole('option').all()) expect((await option.boundingBox()).height).toBeGreaterThanOrEqual(44);
        await city.fill(language === 'ar' ? 'سالم' : 'Sal');
        await expect(menu.getByRole('option')).toHaveCount(1);
        await expect(menu.getByRole('option')).toHaveAttribute('data-city', 'Salmiya');
        await city.fill(language === 'ar' ? 'حولي' : 'Hawalli');
        await expect(menu.getByRole('option')).toHaveCount(1);
        await city.fill('no-such-city');
        await expect(menu.getByRole('status')).toBeVisible();
        await expect(menu.getByRole('option')).toHaveCount(0);
        await city.press('Escape');
        await expect(city).toHaveValue('');
        await expect(city).toHaveAttribute('aria-expanded', 'false');
        await city.click();
        if (width === 360) await menu.locator('[role="option"][data-city="Salmiya"]').tap();
        else {
          await city.press('ArrowDown');
          await city.press('Enter');
        }
        await expect(page.locator('#choose-shop')).toHaveClass(/is-open/);
        const visibleShops = await page.locator('#choose-shop input[name="branch"]').evaluateAll(inputs => inputs.map(input => input.value).sort());
        expect(visibleShops).toEqual(catalog.branches.filter(branch => branch.city === 'Salmiya').map(branch => branch.id).sort());
        expect(visibleShops.length).toBeGreaterThan(0);
        await page.locator('#choose-city .cb-text-button').click();
        await city.click();
        await city.fill('cancel this search');
        await page.getByRole('heading', { level: 1 }).click();
        await expect(city).toHaveValue(language === 'ar' ? 'السالمية' : 'Salmiya');
        await expect(city).toHaveAttribute('aria-expanded', 'false');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        if (width === 360) {
          await city.click();
          await page.screenshot({ path: `.cloud-test/city-picker-${language}-${theme}.png` });
        }
      }
    });
  }
}
