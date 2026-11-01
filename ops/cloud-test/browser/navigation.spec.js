import { test, expect, chooseBookingCity } from './fixtures.js';
import fs from 'node:fs';
const state = JSON.parse(fs.readFileSync(new URL('../../../.cloud-test/credentials.json', import.meta.url)));

const publicRoutes = ['/', '/book', '/customer/sign-in', '/customer/sign-up', '/customer/forgot-password', '/customer/reset-password', '/login', '/signup', '/forgot-password', '/reset-password', '/accept-invite', '/privacy'];

test('one public header and footer connect every entry page', async ({ page }) => {
  for (const route of publicRoutes) {
    await page.goto(route);
    const header = page.locator('.public-header');
    await expect(header).toHaveCount(1);
    await expect(page.locator('.public-footer')).toBeVisible();
    await expect(header.getByRole('link', { name: 'Barber++ home' })).toHaveAttribute('href', '/');
    await expect(header.getByRole('link', { name: 'Book appointment', exact: true })).toHaveAttribute('href', '/book');
    await header.getByRole('button', { name: 'Shops', exact: true }).click();
    await expect(header.getByRole('link', { name: 'Customer sign in' })).toHaveAttribute('href', '/customer/sign-in');
    await expect(header.getByRole('link', { name: 'Team sign in' })).toHaveAttribute('href', '/login');
    await page.keyboard.press('Escape');
    await expect(header.getByRole('button', { name: 'Shops', exact: true })).toBeFocused();
  }
  await page.locator('.public-footer').getByRole('link', { name: 'Features', exact: true }).click();
  await expect(page).toHaveURL(/\/#for-shops$/);
  await expect.poll(() => page.locator('#for-shops').evaluate(el => {
    const headerBottom = document.querySelector('.public-header').getBoundingClientRect().bottom;
    const top = el.getBoundingClientRect().top;
    return top >= headerBottom && top < innerHeight;
  })).toBe(true);
});

for (const language of ['en', 'ar']) {
  test(`mobile menu is reachable and keyboard operable in ${language}`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.addInitScript(language => localStorage.setItem('barber-language', language), language);
    await page.goto('/customer/sign-in');
    const open = language === 'ar' ? 'فتح القائمة' : 'Open menu';
    const close = language === 'ar' ? 'إغلاق القائمة' : 'Close menu';
    const book = language === 'ar' ? 'احجز موعداً' : 'Book appointment';
    const toggle = page.getByRole('button', { name: open, exact: true });
    await expect.poll(() => toggle.evaluate(el => {
      const box = el.getBoundingClientRect();
      return box.top >= document.querySelector('.environment-banner').getBoundingClientRect().bottom && el.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
    })).toBe(true);
    await toggle.click();
    await expect(page.getByRole('button', { name: close })).toHaveAttribute('aria-expanded', 'true');
    const menu = page.locator('#public-mobile-links');
    await expect(menu.getByRole('heading', { name: language === 'ar' ? 'العملاء' : 'Customers', exact: true })).toBeVisible();
    await expect(menu.getByRole('heading', { name: language === 'ar' ? 'الصالونات' : 'Shops', exact: true })).toBeVisible();
    await expect(menu.getByRole('link')).toHaveCount(4);
    for (const link of await menu.getByRole('link').all()) await expect(link).toBeInViewport();
    await expect(menu.getByRole('button')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(toggle).toBeFocused();
    await toggle.click();
    await page.locator('#public-mobile-links').getByRole('link', { name: book, exact: true }).click();
    await expect(page).toHaveURL(/\/book$/);
    await expect(page.locator('#public-mobile-links')).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
}

test('homepage to customer signup restores the booking and offers account navigation', async ({ page, request }) => {
  const email = `navigation-${Date.now()}@barber.test`;
  await page.goto('/');
  await page.locator('.hero-cta').getByRole('link', { name: 'Book appointment' }).click();
  await chooseBookingCity(page, 'Kuwait City');
  await page.locator('input[name="branch"][value="10000000-0000-4000-8000-000000000011"]').check();
  await page.locator('input[name="barber"]').first().check();
  await page.locator('#choose-services input[type="checkbox"]').first().check();
  await page.locator('.public-header').getByRole('link', { name: 'Customer sign in' }).click();
  await page.locator('.ca-main').getByRole('link', { name: 'Create account', exact: true }).click();
  await page.locator('#customer-auth-name').fill('Navigation Test Customer');
  await page.locator('#customer-auth-email').fill(email);
  await page.locator('#password').fill(state.staffPassword);
  await page.locator('#confirmPassword').fill(state.staffPassword);
  await page.locator('button[type="submit"]').click();
  await expect(page.locator('.ca-main [role="status"]')).toBeVisible();
  const inbox = await request.get('/test-inbox?format=json');
  expect(inbox.ok()).toBe(true);
  const messages = await inbox.json();
  const message = messages.find(mail => mail.recipient === email && (mail.link || mail.payload?.email_data?.email_action_type === 'signup'));
  expect(message).toBeTruthy();
  const data = message.payload?.email_data;
  const confirmation = message.link || (() => {
    const url = new URL(`https://${state.projectRef}.supabase.co/auth/v1/verify`);
    url.searchParams.set('token', data.token_hash); url.searchParams.set('type', data.email_action_type); url.searchParams.set('redirect_to', data.redirect_to); return url.href;
  })();
  await page.goto(confirmation);
  await expect(page.locator('#customer-auth-title')).toHaveText('Email verified');
  await page.locator('.ca-main').getByRole('link', { name: 'Book an appointment', exact: true }).click();
  await expect(page).toHaveURL(/\/book$/);
  await expect(page.locator('#choose-services input[type="checkbox"]').first()).toBeChecked();
  await page.locator('.public-header').getByRole('button', { name: 'My account', exact: true }).click();
  await page.locator('#public-account-links').getByRole('link', { name: 'My appointments', exact: true }).click();
  await expect(page).toHaveURL(/\/customer\/account#appointments$/);
  await expect(page.locator('#appointments')).toBeVisible();
  await expect(page.locator('.ca-main')).toContainText('Navigation Test Customer');
  await page.reload();
  await expect(page.locator('.ca-main')).toContainText('Navigation Test Customer');
  await page.locator('.public-header').getByRole('link', { name: 'Barber++ home', exact: true }).click();
  await expect(page.locator('#hero-title')).toBeVisible();
  await expect(page.locator('.public-header').getByRole('button', { name: 'My account', exact: true })).toBeVisible();
});
