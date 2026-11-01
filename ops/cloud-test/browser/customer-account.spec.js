import { test, expect } from './fixtures.js';
import fs from 'node:fs';
const state = JSON.parse(fs.readFileSync(new URL('../../../.cloud-test/credentials.json', import.meta.url)));
const engine = process.env.CLOUD_TEST_BROWSER || 'chromium';
test.use({ browserName: engine });
const main = page => page.locator('.ca-account');
async function createCustomer(page, request) {
  const email = `account-design-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.test`;
  await page.goto('/customer/sign-up');
  await page.locator('#customer-auth-name').fill('Account Design Customer'); await page.locator('#customer-auth-email').fill(email);
  await page.locator('#password').fill(state.staffPassword); await page.locator('#confirmPassword').fill(state.staffPassword);
  await page.locator('.ca-main').getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.locator('#email-code')).toBeVisible();
  const response = await request.get('/test-inbox?format=json'); expect(response.ok()).toBe(true);
  const message = (await response.json()).find(m => m.recipient === email && m.payload?.email_data?.email_action_type === 'signup');
  expect(Boolean(message)).toBe(true);
  await page.locator('#email-code').fill(message.payload.email_data.token);
  await page.locator('.ca-main').getByRole('button', { name: 'Verify & continue', exact: true }).click();
  await expect(page.locator('#customer-auth-title')).toHaveText('Email verified');
  await page.locator('.ca-main').getByRole('link', { name: 'My account', exact: true }).click();
  await expect(main(page)).toBeVisible();
}
async function theme(page, desired) {
  if (await page.locator('html').getAttribute('data-theme') !== desired) await page.getByRole('button', { name: /Switch to .* mode|التبديل إلى/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', desired);
}
async function noOverflow(page) { expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true); }

test('real customer profile edit, cancel, booking details and account actions', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await createCustomer(page, request); await theme(page, 'light');
  await expect(main(page).getByRole('heading', { name: 'Your next appointment starts here' })).toBeVisible();
  await page.screenshot({ path: `.cloud-test/account-${engine}-empty-mobile-light.png` });
  await main(page).getByRole('button', { name: 'Edit details', exact: true }).click();
  await page.locator('#account-name').fill('Unsaved Customer');
  await main(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(main(page).locator('.ca-profile-details')).toContainText('Account Design Customer');
  await main(page).getByRole('button', { name: 'Edit details', exact: true }).click();
  await expect(page.locator('#account-name')).toHaveValue('Account Design Customer');
  const phone = '5' + String(Date.now() % 10000000).padStart(7, '0');
  await page.locator('#account-name').fill('Barber Test Customer'); await page.locator('#account-phone').fill(phone);
  await expect(page.getByRole('combobox', { name: 'Country calling code' }).locator('option').first()).toContainText('🇰🇼');
  await main(page).getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(main(page).getByRole('status')).toContainText('Your details have been saved.');
  await page.reload(); await expect(main(page).locator('.ca-profile-details')).toContainText('Barber Test Customer');
  await expect(main(page).locator('.ca-profile-details')).toContainText(`+965 ${phone}`);
  await main(page).getByRole('link', { name: 'Book an appointment', exact: true }).click();
  await page.locator('#booking-city').selectOption('Kuwait City');
  await page.locator('input[name="branch"][value="10000000-0000-4000-8000-000000000011"]').check();
  await page.locator('input[name="barber"]').first().check(); await page.locator('#choose-services input[type="checkbox"]').first().check();
  await page.locator('#booking-next').click();
  await page.locator('#booking-date').fill(new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10));
  await page.locator('input[name="time"]').first().check();
  await page.locator('#booking-next').click();
  await expect(page.locator('.cb-success')).toBeVisible();
  await page.goto('/customer/account#appointments');
  await expect(main(page).locator('.ca-booking-row')).toHaveCount(1);
  await expect(main(page).locator('.ca-booking-row')).toContainText('Haircut');
  await expect(main(page).locator('.ca-status')).toContainText('Confirmed');
  await expect(main(page).locator('time')).toBeVisible(); await noOverflow(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await main(page).getByRole('heading', { name: 'My account', exact: true }).click();
  await page.screenshot({ path: `.cloud-test/account-${engine}-desktop-light.png`, fullPage: true });
  await main(page).getByRole('link', { name: 'Change password', exact: true }).click();
  await expect(page).toHaveURL(/\/customer\/forgot-password$/);
  await page.locator('.ca-main').getByRole('link', { name: 'Back to sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/customer\/account$/);
  await main(page).getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/book$/);
  await page.goto('/customer/account'); await expect(page).toHaveURL(/\/customer\/sign-in$/);
});

test('account and edit form fit English and Arabic in both themes across mobile and desktop', async ({ page, request }) => {
  await createCustomer(page, request);
  for (const language of ['en', 'ar']) {
    await page.locator('.preferences-selector').first().locator('button').first().click();
    await page.getByRole('button', { name: language === 'en' ? 'English' : 'العربية', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('dir', language === 'ar' ? 'rtl' : 'ltr');
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      for (const appearance of ['light', 'dark']) {
        await theme(page, appearance); await noOverflow(page);
        await main(page).getByRole('button', { name: language === 'ar' ? 'تعديل البيانات' : 'Edit details', exact: true }).click();
        await expect(page.locator('#account-email')).toBeVisible(); await noOverflow(page);
        if (width === 390) await page.screenshot({ path: `.cloud-test/account-${engine}-${language}-edit-${appearance}.png`, fullPage: true });
        await main(page).getByRole('button', { name: language === 'ar' ? 'إلغاء' : 'Cancel', exact: true }).click();
        if (width === 390) await page.screenshot({ path: `.cloud-test/account-${engine}-${language}-${appearance}.png`, fullPage: true });
      }
    }
  }
});
