import { test, expect } from './fixtures.js';
import fs from 'node:fs';
const accountPath = new URL('../../../.cloud-test/rebook-test-account.json', import.meta.url);
const engine = process.env.CLOUD_TEST_BROWSER || 'chromium';
test.use({ browserName: engine, viewport: { width: 390, height: 844 } });
test.skip(!fs.existsSync(accountPath), 'Requires the isolated synthetic rebooking account and its owned history fixtures.');
const account = fs.existsSync(accountPath) ? JSON.parse(fs.readFileSync(accountPath)) : {};

for (const language of ['en', 'ar']) for (const appearance of ['light', 'dark']) {
  test(`past appointments rebook with editable selections: ${engine} ${language} ${appearance}`, async ({ page }) => {
    await page.goto('/customer/sign-in');
    await page.locator('#customer-auth-email').fill(account.email);
    await page.locator('#password').fill(account.password);
    await page.locator('.ca-main').getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL(/\/customer\/account$/);
    await page.locator('.preferences-selector').first().locator('button').first().click();
    await page.getByRole('button', { name: language === 'en' ? 'English' : 'العربية', exact: true }).click();
    if (await page.locator('html').getAttribute('data-theme') !== appearance) await page.getByRole('button', { name: /Switch to .* mode|التبديل إلى/ }).click();
    const main = page.locator('.ca-account');
    await expect(main.locator('.ca-booking-row')).toHaveCount(1);
    await expect(main.getByRole('button', { name: language === 'en' ? 'Book again' : 'احجز مرة أخرى', exact: true })).toHaveCount(0);
    await main.getByRole('button', { name: language === 'en' ? 'Past appointments' : 'المواعيد السابقة', exact: true }).click();
    await expect(main.locator('.ca-booking-row')).toHaveCount(2);
    await expect(main.locator('.ca-booking-row').first().locator('.ca-status')).toHaveText(language === 'en' ? 'Cancelled' : 'ملغي');
    await expect(page.locator('html')).toHaveAttribute('data-theme', appearance);
    await expect(page.locator('body')).toHaveJSProperty('scrollWidth', await page.locator('body').evaluate(el => el.clientWidth));
    await page.screenshot({ path: `.cloud-test/rebook-${engine}-${language}-${appearance}-history.png`, fullPage: true });
    await main.locator('.ca-appointments').screenshot({ path: `.cloud-test/rebook-${engine}-${language}-${appearance}-history-panel.png` });
    await main.locator('.ca-booking-row').last().getByRole('button', { name: language === 'en' ? 'Book again' : 'احجز مرة أخرى', exact: true }).click();
    await expect(page).toHaveURL(/\/book$/);
    await expect(page.locator('#choose-services')).toHaveClass(/is-open/);
    for (const id of ['choose-city', 'choose-shop', 'choose-barber']) {
      await expect(page.locator(`#${id} .cb-section-summary`)).toBeVisible();
      await expect(page.locator(`#${id} .cb-section-heading button`)).toBeEnabled();
    }
    await expect(page.locator('#choose-services input:checked')).toHaveCount(0);
    await expect(page.locator('#choose-time input[name="time"]:checked')).toHaveCount(0);
    await expect(page.locator('#booking-next')).toBeDisabled();
    await page.screenshot({ path: `.cloud-test/rebook-${engine}-${language}-${appearance}-services.png`, fullPage: true });
    await page.locator('#choose-services input[type="checkbox"]').first().check();
    await page.locator('#booking-next').click();
    await expect(page.locator('#choose-time')).toHaveClass(/is-open/);
    await page.locator('#booking-date').fill(new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10));
    await expect(page.locator('input[name="time"]').first()).toBeVisible();
    await page.locator('#choose-barber .cb-section-heading button').click();
    const selectedBarber = page.locator('input[name="barber"]:checked');
    await expect(selectedBarber).toHaveCount(1);
    await page.locator('input[name="barber"]:not(:checked)').first().check();
    await expect(page.locator('#choose-services input:checked')).toHaveCount(0);
    await page.locator('#choose-shop .cb-section-heading button').click();
    await expect(page.locator('#choose-shop')).toHaveClass(/is-open/);
    await page.locator('input[name="branch"]:not(:checked)').first().check();
    await expect(page.locator('#choose-barber')).toHaveClass(/is-open/);
    await expect(page.locator('input[name="barber"]:checked')).toHaveCount(0);
    await page.locator('#choose-city .cb-section-heading button').click();
    await page.locator('#booking-city').click();
    const currentCity = await page.locator('[role="option"][aria-selected="true"]').getAttribute('data-city');
    const different = page.locator('[role="option"][aria-selected="false"]').first();
    expect(await different.getAttribute('data-city')).not.toBe(currentCity);
    await different.click();
    await expect(page.locator('#choose-shop')).toHaveClass(/is-open/);
    await expect(page.locator('#choose-barber .cb-section-summary')).toHaveCount(0);
    await expect(page.locator('#choose-services input:checked')).toHaveCount(0);
    await expect(page.locator('body')).toHaveJSProperty('scrollWidth', await page.locator('body').evaluate(el => el.clientWidth));
  });
}
