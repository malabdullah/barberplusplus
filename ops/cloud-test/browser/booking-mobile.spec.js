import { test, expect } from './fixtures.js';

test.use({ isMobile: true, hasTouch: true });

for (const language of ['en', 'ar']) {
  test(`clean sections and date focus stay within the viewport in ${language}`, async ({ page, browserName }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(language => {
      localStorage.setItem('barber-language', language);
      localStorage.setItem('barber-theme', 'light');
    }, language);
    await page.goto('/book');
    await expect(page.locator('#booking-city')).toBeVisible();
    await expect(page.locator('.cb-city-step > .cb-helper, .cb-section-pending')).toHaveCount(0);
    await expect(page.locator('[data-booking-section] > .cb-section-heading > h2')).toHaveCount(6);
    await page.screenshot({ path: `.cloud-test/booking-clean-${browserName}-${language}.png`, fullPage: true });
    await page.locator('#booking-city').selectOption('Kuwait City');
    await page.locator('.cb-option:has(input[name="branch"][value="10000000-0000-4000-8000-000000000011"])').click();
    await page.locator('.cb-option:has(input[name="barber"])').first().click();
    await page.locator('#choose-services .cb-service').first().click();
    await page.locator('#booking-next').click();
    const date = page.locator('#booking-date');
    await expect(date).toBeVisible();
    const minimum = await date.getAttribute('min');
    const followingDay = new Date(`${minimum}T12:00:00Z`);
    followingDay.setUTCDate(followingDay.getUTCDate() + 1);
    const nextDate = followingDay.toISOString().slice(0, 10);
    for (const width of [320, 375, 390, 430, 465, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      await date.click();
      await page.keyboard.press('Escape');
      await date.fill(nextDate);
      await expect(date).toHaveValue(nextDate);
      await expect.poll(() => page.evaluate(() => {
        const input = document.querySelector('#booking-date');
        const box = input.getBoundingClientRect();
        const wrapper = input.parentElement.getBoundingClientRect();
        return document.documentElement.scrollWidth <= innerWidth + 1 &&
          document.body.scrollWidth <= innerWidth + 1 &&
          wrapper.left >= 0 && wrapper.right <= innerWidth + 1 &&
          box.left >= wrapper.left && box.right <= wrapper.right + 1 &&
          (visualViewport?.scale || 1) <= 1.01;
      })).toBe(true);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('input[name="time"]').first()).toBeAttached();
    await date.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `.cloud-test/booking-date-${browserName}-${language}.png` });
    await page.locator('.cb-time-options label').first().click();
    await expect(page.locator('#choose-details')).toHaveClass(/is-open/);
    await expect(page.locator('.cb-confirm-summary')).toBeVisible();
    // Stop before submitting: this layout check creates no appointment.
  });
}
