import { test, expect, chooseBookingCity } from './fixtures.js';
import fs from 'node:fs';

const state = JSON.parse(fs.readFileSync('.cloud-test/credentials.json'));
const key = JSON.parse(fs.readFileSync('.cloud-test/api-keys.json')).find(item => item.name === 'anon').api_key;
const copy = Object.fromEntries(['en', 'ar'].map(language => [language, JSON.parse(fs.readFileSync(`src/i18n/locales/${language}.json`))]));
const engine = process.env.CLOUD_TEST_BROWSER || 'chromium';
const selection = { branchId: 'b6110203-0000-4000-8000-000000000001', barberId: 'b6110205-0000-4000-8000-000000000001', serviceIds: ['b6110204-0000-4000-8000-000000000011'] };
let customers; let date;
test.use({ browserName: engine, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

async function call(request, action, data = {}, token = '', fn = 'customer-booking') {
  const response = await request.post(`/test-api/${fn}`, { headers: { Origin: state.appUrl, apikey: key, ...(token ? { Authorization: `Bearer ${token}` } : {}) }, data: { action, ...data } });
  return { status: response.status(), data: await response.json() };
}

test.beforeAll(async ({ request }) => {
  expect(state.projectRef).toBe('qvkucvcjmojjbphlzlks');
  const gate = await request.get(state.appUrl, { headers: { Authorization: `Basic ${Buffer.from(`tester:${state.accessPassword}`).toString('base64')}` } }); expect(gate.ok()).toBe(true);
  customers = JSON.parse(fs.readFileSync('.cloud-test/flow-fixtures.json'));
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kuwait' });
  for (let day = 1; day < 14; day++) {
    const candidate = new Date(new Date(`${today}T12:00:00+03:00`).getTime() + day * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kuwait' });
    const result = await call(request, 'slots', { ...selection, date: candidate });
    expect(result.status).toBe(200);
    if (result.data.slots.length >= 8) { date = candidate; break; }
  }
  expect(date).toBeTruthy();
});

async function choose(page, language = 'en', theme = 'light') {
  await page.addInitScript(({ language, theme }) => {
    localStorage.setItem('barber-language', language); localStorage.setItem('barber-theme', theme);
  }, { language, theme });
  await page.goto('/book', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('html')).toHaveAttribute('lang', language);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await chooseBookingCity(page, 'Sharq');
  await page.locator(`.cb-option:has(input[name="branch"][value="${selection.branchId}"])`).click();
  await page.locator('#choose-barber .cb-option').filter({ hasText: language === 'en' ? 'Omar' : 'عمر' }).click();
  await page.locator('#choose-services .cb-service').first().click();
  await page.locator('#booking-next').click();
  await expect(page.locator('#choose-time .cb-loading')).toHaveCount(0);
  await page.locator('#booking-date').fill(date);
  await expect(page.locator('.cb-time-options label').first()).toBeVisible();
  await page.locator('.cb-time-options label').first().click();
  await expect(page.locator('#choose-details')).toHaveClass(/is-open/);
  await expect(page.locator('#booking-next')).toHaveCount(0);
  await expect(page.locator('#customer-name')).toHaveCount(0);
}
async function login(page, customer = customers[0]) {
  await page.locator('#customer-auth-email').fill(customer.email);
  await page.locator('#password').fill(customer.password);
  await page.locator('.ca-panel button[type="submit"]').click();
  await expect(page).toHaveURL(/\/book$/);
}
async function noOverflow(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1 && document.body.scrollWidth <= innerWidth + 1)).toBe(true);
}

for (const language of ['en', 'ar']) for (const theme of ['light', 'dark']) {
  test(`checkout choice and login retain selection and notes: ${engine} ${language} ${theme}`, async ({ page }) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const tr = copy[language].customerBooking;
    await choose(page, language, theme);
    await page.screenshot({ path: `.cloud-test/checkout-choice-${engine}-${language}-${theme}.png` });
    await page.getByRole('button', { name: tr.accountChoice.guest, exact: true }).click();
    await page.locator('#customer-name').fill('Guest draft name'); await page.locator('#customer-phone').fill(customers[0].phone);
    await page.locator('#booking-notes').fill('Preserve this note through login');
    const before = await page.evaluate(() => JSON.parse(localStorage.getItem('barber-customer-booking-draft')));
    await page.getByRole('link', { name: copy[language].customerAuth.signIn, exact: true }).click();
    await expect(page.locator('#password')).toBeVisible();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#password')).toBeVisible();
    const otherTab = await page.context().newPage(); await otherTab.goto('/book', { waitUntil: 'domcontentloaded' });
    await expect(otherTab.locator('#customer-name')).toHaveValue('Guest draft name');
    await expect(otherTab.locator('#booking-notes')).toHaveValue('Preserve this note through login'); await otherTab.close();
    await page.locator('.ca-back').click();
    await expect(page.locator('#customer-name')).toHaveValue('Guest draft name');
    await page.getByRole('link', { name: copy[language].customerAuth.signIn, exact: true }).click();
    await login(page);
    await expect(page.locator('.cb-verified-details')).toContainText(customers[0].profile.name);
    await expect(page.locator('#booking-notes')).toHaveValue('Preserve this note through login');
    await expect(page.locator('#booking-next')).toBeEnabled();
    const after = await page.evaluate(() => JSON.parse(localStorage.getItem('barber-customer-booking-draft')));
    for (const field of ['city', 'branchId', 'barberId', 'date', 'time']) expect(after[field]).toBe(before[field]);
    expect(after.serviceIds).toEqual(before.serviceIds);
    await expect(page.locator('.cb-success')).toHaveCount(0);
    await noOverflow(page); await page.screenshot({ path: `.cloud-test/checkout-signed-${engine}-${language}-${theme}.png` });
    expect(errors).toEqual([]);
  });
}

test('guest confirms, signs in, saves one receipt, and sees it in account history', async ({ page }) => {
  await choose(page);
  await page.getByRole('button', { name: 'Continue as guest', exact: true }).click();
  await page.locator('#customer-name').fill('Do not overwrite the account profile'); await page.locator('#guest-email').fill(customers[0].email);
  await page.locator('#booking-notes').fill('Synthetic checkout guest receipt test');
  const booked = page.waitForResponse(response => response.url().includes('customer-booking') && response.request().postDataJSON()?.action === 'book');
  await page.locator('#booking-next').click(); const result = await booked; expect(result.status()).toBe(200); const receipt = await result.json();
  expect(receipt.claimToken).toBeTruthy(); await expect(page.locator('.cb-success')).toBeVisible();
  fs.writeFileSync(`.cloud-test/checkout-${engine}-guest-booking.json`, JSON.stringify({ id: receipt.id, reference: receipt.reference }));
  await page.getByRole('link', { name: copy.en.customerBooking.accountChoice.signInSave, exact: true }).click(); await login(page);
  await expect(page.locator('.cb-reference')).toContainText(receipt.reference);
  const saved = page.waitForResponse(response => response.url().includes('customer-booking') && response.request().postDataJSON()?.action === 'claim-booking');
  await page.getByRole('button', { name: 'Save to my account', exact: true }).click(); expect((await saved).status()).toBe(200);
  await expect(page.getByText(copy.en.customerBooking.accountChoice.saved, { exact: true })).toBeVisible();
  const history = page.waitForResponse(response => response.url().includes('customer-auth') && response.request().postDataJSON()?.action === 'bookings');
  await page.locator('.cb-success').getByRole('link', { name: copy.en.customerAuth.myAccount, exact: true }).click();
  expect((await (await history).json()).bookings.some(booking => booking.id === receipt.id)).toBe(true);
  await expect(page.locator('.ca-profile-details')).toContainText(customers[0].profile.name);
  await expect(page.locator('.ca-booking-list')).toContainText(receipt.branch_name);
});

test('email confirmation in another tab resumes the pending appointment', async ({ page, request }) => {
  await choose(page);
  await page.getByRole('link', { name: 'Sign in', exact: true }).click();
  await page.getByRole('link', { name: 'Create account', exact: true }).click();
  const email = `checkout-browser-${engine}-${Date.now()}@example.test`;
  await page.locator('#customer-auth-name').fill('Checkout Email Customer'); await page.locator('#customer-auth-email').fill(email);
  await page.locator('#password').fill(state.staffPassword); await page.locator('#confirmPassword').fill(state.staffPassword);
  await page.locator('button[type="submit"]').click(); await expect(page).toHaveURL(/verify-email/);
  const inbox = await request.get('/test-inbox?format=json'); const messages = await inbox.json();
  const mail = messages.find(message => message.recipient === email && message.payload?.email_data?.email_action_type === 'signup'); expect(mail).toBeTruthy();
  const callback = new URL('/customer/email-callback', state.appUrl); callback.searchParams.set('type', 'signup'); callback.searchParams.set('token_hash', mail.payload.email_data.token_hash); callback.searchParams.set('next', 'book');
  const tab = await page.context().newPage(); await tab.goto(callback.href, { waitUntil: 'domcontentloaded' });
  await tab.getByRole('link', { name: 'Continue booking', exact: true }).click();
  await expect(tab.locator('.cb-verified-details')).toContainText('Checkout Email Customer');
  await expect(tab.locator('#customer-phone')).toBeVisible();
  await expect(tab.locator('#choose-details')).toHaveClass(/is-open/); await expect(tab.locator('.cb-success')).toHaveCount(0);
  await tab.close();
});

test('a time taken during login returns to time selection and preserves the rest', async ({ page, request }) => {
  await choose(page);
  await page.getByRole('button', { name: 'Continue as guest', exact: true }).click();
  await page.locator('#booking-notes').fill('Keep this when the slot is taken');
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('barber-customer-booking-draft')));
  const proof = await call(request, 'guest-proof', { name: 'Synthetic competing guest', contactMode:'email',email:'competing@example.test',countryCode: '+965' }); expect(proof.status).toBe(200);
  const occupied = await call(request, 'book', { ...before, verification: proof.data.verification }); expect(occupied.status).toBe(200);
  fs.writeFileSync(`.cloud-test/checkout-${engine}-conflict-booking.json`, JSON.stringify({ id: occupied.data.id }));
  await page.getByRole('link', { name: 'Sign in', exact: true }).click(); await login(page);
  await expect(page.locator('#choose-time')).toHaveClass(/is-open/);
  await expect(page.getByRole('alert')).toContainText(copy.en.customerBooking.errors.SLOT_UNAVAILABLE);
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('barber-customer-booking-draft')));
  for (const field of ['city', 'branchId', 'barberId', 'date']) expect(after[field]).toBe(before[field]);
  expect(after.serviceIds).toEqual(before.serviceIds); expect(after.time).toBe('');
  await page.locator('.cb-time-options label').first().click();
  await expect(page.locator('#booking-notes')).toHaveValue('Keep this when the slot is taken');
  await expect(page.locator('.cb-success')).toHaveCount(0);
});

for (const provider of ['Google', 'Apple']) {
  test(`${provider} cancellation returns to the same booking`, async ({ page }) => {
    await choose(page);
    const before = await page.evaluate(() => JSON.parse(localStorage.getItem('barber-customer-booking-draft')));
    await page.getByRole('link', { name: 'Sign in', exact: true }).click();
    // Exercise the real PKCE start and our cancellation callback without asking
    // for the owner's provider credentials or changing any provider settings.
    await page.route('**/auth/v1/authorize?**', route => route.fulfill({ status: 200, contentType: 'text/html', body: `<html><head><meta http-equiv="refresh" content="0;url=${state.appUrl}/customer/auth-callback?error=access_denied"></head></html>` }));
    await page.getByRole('button', { name: `Continue with ${provider}`, exact: true }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await page.locator('.ca-footer').getByRole('link', { name: copy.en.customerAuth.continueGuest, exact: true }).click();
    await expect(page.locator('#choose-details')).toHaveClass(/is-open/);
    const after = await page.evaluate(() => JSON.parse(localStorage.getItem('barber-customer-booking-draft')));
    expect(after.time).toBe(before.time); expect(after.serviceIds).toEqual(before.serviceIds);
    await expect(page.locator('.cb-success')).toHaveCount(0);
  });
}

test('login before confirmation creates an account-owned appointment directly', async ({ page }) => {
  await choose(page);
  await page.getByRole('link', { name: 'Sign in', exact: true }).click(); await login(page);
  await expect(page.locator('.cb-verified-details')).toContainText(customers[0].profile.name);
  await expect(page.locator('.cb-success')).toHaveCount(0);
  await page.locator('#booking-notes').fill('Synthetic checkout account test');
  await expect(page.locator('#booking-next')).toBeEnabled();
  const booked = page.waitForResponse(response => response.url().includes('customer-booking') && response.request().postDataJSON()?.action === 'book');
  await page.locator('#booking-next').click(); const response = await booked; expect(response.status()).toBe(200); const receipt = await response.json();
  expect(receipt.claimToken).toBeUndefined();
  fs.writeFileSync(`.cloud-test/checkout-${engine}-account-booking.json`, JSON.stringify({ id: receipt.id }));
  await expect(page.getByText(copy.en.customerBooking.accountChoice.saved, { exact: true })).toBeVisible();
  const history = page.waitForResponse(response => response.url().includes('customer-auth') && response.request().postDataJSON()?.action === 'bookings');
  await page.locator('.cb-success').getByRole('link', { name: copy.en.customerAuth.myAccount, exact: true }).click();
  expect((await (await history).json()).bookings.some(booking => booking.id === receipt.id)).toBe(true);
  await expect(page.locator('.ca-profile-details')).toContainText(customers[0].profile.name);
});
