import { test, expect } from './fixtures.js';
import fs from 'node:fs';
const state = JSON.parse(fs.readFileSync(new URL('../../../.cloud-test/credentials.json', import.meta.url)));
const uniqueEmail = () => `auth-design-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.test`;
const panel = page => page.locator('.ca-main');
async function mail(request, email, type) {
  let found;
  await expect.poll(async () => {
    const response = await request.get('/test-inbox?format=json');
    expect(response.ok()).toBe(true);
    found = (await response.json()).find(message => message.recipient === email && message.payload?.email_data?.email_action_type === type);
    return Boolean(found);
  }).toBe(true);
  return found.payload.email_data;
}
function link(data) {
  const url = new URL(`https://${state.projectRef}.supabase.co/auth/v1/verify`);
  url.searchParams.set('token', data.token_hash); url.searchParams.set('type', data.email_action_type); url.searchParams.set('redirect_to', data.redirect_to);
  return url.href;
}
async function signup(page, email) {
  await page.goto('/customer/sign-up');
  await page.locator('#customer-auth-name').fill('Email Journey Customer');
  await page.locator('#customer-auth-email').fill(email);
  await page.locator('#password').fill(state.staffPassword);
  await page.locator('#confirmPassword').fill(state.staffPassword);
  await panel(page).getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page).toHaveURL(/\/customer\/verify-email\?purpose=signup$/);
  await expect(page.locator('#email-code')).toBeVisible();
}
async function enterCode(page, token) {
  await page.locator('#email-code').fill(token);
  await panel(page).getByRole('button', { name: 'Verify & continue', exact: true }).click();
}
async function verifyLayout(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await expect(page.locator('.public-header')).toHaveCount(1);
  await expect(page.locator('.ca-panel')).toBeVisible();
  await expect(panel(page).getByRole('link', { name: /Back to sign in|العودة إلى تسجيل الدخول/ })).toHaveAttribute('href', '/customer/sign-in');
}

test('email code signup, refresh, wrong code, password recovery and new-password sign in', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const email = uniqueEmail();
  await signup(page, email);
  const confirmation = await mail(request, email, 'signup');
  await page.reload(); await expect(panel(page)).toContainText(email);
  await enterCode(page, confirmation.token === '000000' ? '111111' : '000000');
  await expect(panel(page).getByRole('alert')).toContainText('incorrect');
  await enterCode(page, confirmation.token);
  await expect(page.locator('#customer-auth-title')).toHaveText('Email verified');
  await verifyLayout(page);
  await page.screenshot({ path: '.cloud-test/customer-email-code-success.png', fullPage: true });
  await panel(page).getByRole('link', { name: 'My account', exact: true }).click();
  await expect(page).toHaveURL(/\/customer\/account$/);
  await panel(page).getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.goto('/customer/forgot-password'); await verifyLayout(page);
  await page.locator('#customer-auth-email').fill(email);
  await panel(page).getByRole('button', { name: 'Send reset link', exact: true }).click();
  await expect(page).toHaveURL(/verify-email\?purpose=recovery$/);
  const recovery = await mail(request, email, 'recovery');
  await enterCode(page, recovery.token);
  await expect(page).toHaveURL(/\/customer\/reset-password$/);
  const changed = 'ChangedTest123!';
  await page.locator('#password').fill(changed); await page.locator('#confirmPassword').fill(changed);
  await panel(page).getByRole('button', { name: 'Reset password', exact: true }).click();
  await expect(page.locator('#customer-auth-title')).toHaveText('Password updated');
  await page.screenshot({ path: '.cloud-test/customer-password-updated.png', fullPage: true });
  await panel(page).getByRole('link', { name: 'Sign in', exact: true }).click();
  await page.locator('#customer-auth-email').fill(email); await page.locator('#password').fill(changed);
  await panel(page).getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/customer\/account$/);
  // A consumed confirmation cannot be used again; recovery stays on the branded site.
  await page.goto(link(confirmation));
  await expect(page.locator('#customer-auth-title')).toHaveText('This link has expired');
  await expect(panel(page).getByRole('link', { name: 'Verify email or request a new code' })).toBeVisible();
  expect(new URL(page.url()).hash).toBe('');
});

test('confirmation and recovery email links work in another browser context', async ({ page, request, browser, context }) => {
  const email = uniqueEmail(); await signup(page, email);
  const confirmation = await mail(request, email, 'signup');
  const other = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await other.addCookies((await context.cookies()).filter(cookie => cookie.name === 'barber_test_access'));
  const target = await other.newPage();
  try {
    await target.goto(link(confirmation));
    await expect(target.locator('#customer-auth-title')).toHaveText('Email verified');
    await verifyLayout(target);
    expect(new URL(target.url()).hash).toBe(''); expect(new URL(target.url()).search).toBe('');
    await target.goto('/customer/forgot-password');
    await target.locator('#customer-auth-email').fill(email);
    await panel(target).getByRole('button', { name: 'Send reset link', exact: true }).click();
    const recovery = await mail(request, email, 'recovery');
    await page.goto(link(recovery));
    await expect(page).toHaveURL(/\/customer\/reset-password$/);
    await expect(page.locator('#password')).toBeVisible();
    await verifyLayout(page);
  } finally { await other.close(); }
});

for (const engine of ['chromium', 'webkit']) {
  test.describe(`${engine} responsive authentication`, () => {
    test.use({ browserName: engine });
    test('English and Arabic, both themes, mobile widths and expired callback', async ({ page }) => {
      for (const language of ['en', 'ar']) {
        await page.addInitScript(language => localStorage.setItem('barber-language', language), language);
        for (const width of [320, 390, 768, 1280]) {
          await page.setViewportSize({ width, height: 900 });
          for (const route of ['sign-in', 'sign-up', 'forgot-password', 'verify-email', 'reset-password', 'email-callback#error=access_denied&error_code=otp_expired']) {
            await page.goto(`/customer/${route}`);
            await expect(page.locator('.ca-panel')).toBeVisible();
            await expect(page.locator('html')).toHaveAttribute('dir', language === 'ar' ? 'rtl' : 'ltr');
            for (const theme of ['light', 'dark']) {
              if (await page.locator('html').getAttribute('data-theme') !== theme) await page.getByRole('button', { name: /Switch to .* mode|التبديل إلى/ }).click();
              await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
              expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
            }
            if (width === 390 && ['forgot-password', 'verify-email', 'email-callback#error=access_denied&error_code=otp_expired'].includes(route)) await page.screenshot({ path: `.cloud-test/customer-auth-${engine}-${language}-${route.split('#')[0]}.png`, fullPage: true });
          }
        }
      }
    });
  });
}
