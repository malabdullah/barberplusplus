import fs from 'node:fs';
import { test, expect } from './fixtures.js';
const credentials = JSON.parse(fs.readFileSync(new URL('../../../.cloud-test/credentials.json', import.meta.url)));
const engine = process.env.CLOUD_TEST_BROWSER || 'chromium';
test.use({ browserName: engine });
const panel = page => page.locator('.ca-main');
const screenshot = name => `.cloud-test/manager-onboarding-${engine}-${name}.png`;

for (const language of ['en', 'ar']) for (const theme of ['light', 'dark']) {
  test(`public manager entry and signup layout: ${language}, ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.addInitScript(({ language, theme }) => { localStorage.setItem('barber-language', language); localStorage.setItem('barber-theme', theme); }, { language, theme });
    await page.goto('/');
    await expect(page.locator('.lp-team-link')).toHaveAttribute('href', '/login');
    await expect(page.locator('.lp-shop-actions a[href="/signup"]')).toHaveText(language === 'ar' ? 'أنشئ حساب المدير الخاص بك' : 'Create your manager account');
    await expect(page.getByRole('link', {name:/Register your shop|سجّل صالونك/i})).toHaveCount(0);
    await page.goto('/dashboard/branches/new');
    await expect(page).toHaveURL(/\/login$/);
    const signup = panel(page).locator('a[href="/signup"]');
    await expect(signup).toHaveText(language === 'ar' ? 'أنشئ حساب المدير الخاص بك' : 'Create your manager account');
    await signup.click();
    await expect(page.locator('#customer-auth-title')).toHaveText(language === 'ar' ? 'أنشئ حساب المدير الخاص بك' : 'Create your manager account');
    await expect(page.locator('.public-header')).toHaveCount(1);
    await expect(panel(page).locator('a[href="/login"]').first()).toBeVisible();
    await expect(page.locator('#shop-name')).toHaveCount(0);
    await expect(page.locator('select[name="countryCode"] option')).toHaveCount(6);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: screenshot(`signup-${language}-${theme}`), fullPage: true });
  });
}

// Only Chromium creates a synthetic account/shop. Other engines verify the
// public journey and layout without duplicating fixtures or sending messages.
if (engine === 'chromium') test('new manager verifies email, creates a shop and retains ownership after a fresh sign-in', async ({ page, request, context }) => {
  test.setTimeout(240000);
  const suffix = Date.now();
  const initialEmail = `manager-step-one-typo-${suffix}@example.test`;
  const email = `manager-step-one-${suffix}@example.test`;
  const name = `Step One QA Manager ${suffix}`;
  const phone = String(59998000 + Math.floor(Math.random() * 900));
  const password = credentials.staffPassword;
  const shopName = `Step One QA Shop ${suffix}`;
  const runtimeText = await (await request.get('/runtime-config.js')).text();
  const config = JSON.parse(runtimeText.match(/Object\.freeze\((.*)\);/)[1]);
  expect(config.cloudTestProjectRef).toBe('qvkucvcjmojjbphlzlks');
  const headers = { apikey: config.supabasePublishableKey, 'Content-Type': 'application/json' };
  const signIn = (email, pass) => request.post(`${config.supabaseUrl}/auth/v1/token?grant_type=password`, { headers, data: { email, password: pass } });
  const signupFields = async (email, phone) => {
    await page.locator('#name').fill(name); await page.locator('#email').fill(email); await page.locator('#phone').fill(phone);
    await page.locator('#password').fill(password); await page.locator('#confirmPassword').fill(password);
  };
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/signup');
  await signupFields(initialEmail, '123');
  await panel(page).getByRole('button', { name: 'Create Account', exact: true }).click();
  await expect(panel(page).getByRole('alert')).toContainText('phone');
  await page.locator('#phone').fill(phone);
  await panel(page).getByRole('button', { name: 'Create Account', exact: true }).click();
  await expect(page.locator('#customer-auth-title')).toHaveText('Finish setting up your account');
  fs.writeFileSync('.cloud-test/manager-onboarding-fixture.json', JSON.stringify({ initialEmail, email, name, phone, shopName, state: 'signup-created', passwordSource: 'existing Test staffPassword', retainedForOwnerReview: true }, null, 2));
  await expect(panel(page)).toContainText(initialEmail);
  await expect(panel(page).getByRole('button', { name: 'Check verification', exact: true })).toBeVisible();
  await page.reload();
  await expect(panel(page)).toContainText(initialEmail);
  expect(await page.locator('input[type="password"]').count()).toBe(0);
  await panel(page).getByRole('button', { name: 'Check verification', exact: true }).click();
  await expect(panel(page).getByRole('status')).toContainText('not verified');
  const unverified = await signIn(initialEmail, password);
  expect(unverified.ok()).toBe(false);
  expect((await unverified.json()).error_code).toBe('email_not_confirmed');

  await panel(page).getByRole('button', { name: /Correct.*email/i }).click();
  await page.locator('#correct-email-team').fill(email);
  await page.locator('#correct-password-team').fill(password);
  await panel(page).getByRole('button', { name: /Save.*email|Correct.*send/i }).click();
  await expect(panel(page)).toContainText(email);
  await expect(panel(page)).not.toContainText(initialEmail);
  const resend = panel(page).getByRole('button', { name: /^Resend verification email/ });
  await expect(resend).toBeEnabled({ timeout: 70000 });
  await resend.click();
  await expect(panel(page).getByRole('status')).toContainText('new verification email');
  await expect(panel(page).getByRole('button', { name: /^Resend verification email/ })).toBeDisabled();
  await page.screenshot({ path: screenshot('verification'), fullPage: true });

  let message;
  await expect.poll(async () => {
    const inbox = await request.get('/test-inbox?format=json');
    message = (await inbox.json()).find(mail => mail.recipient === email && mail.payload?.email_data?.token_hash);
    return Boolean(message);
  }).toBe(true);
  const mail = message.payload.email_data;
  const confirmation = new URL(`${config.supabaseUrl}/auth/v1/verify`);
  confirmation.searchParams.set('token', mail.token_hash); confirmation.searchParams.set('type', mail.email_action_type); confirmation.searchParams.set('redirect_to', mail.redirect_to);
  const mailContext = await context.browser().newContext({ baseURL: credentials.appUrl, httpCredentials: { username: 'tester', password: credentials.accessPassword, origin: credentials.appUrl } });
  await mailContext.addCookies((await context.cookies()).filter(cookie => cookie.name === 'barber_test_access'));
  const emailTab = await mailContext.newPage(); await emailTab.goto(confirmation.href);
  await expect(emailTab.locator('#customer-auth-title')).toHaveText('Email verified');
  await page.locator('.signup-verification').getByRole('button', { name: 'Check verification', exact: true }).click();
  await expect(page.locator('#customer-auth-title')).toHaveText('Email verified');
  await panel(page).getByRole('link', { name: 'Sign In', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.locator('#email').fill(email); await page.locator('#password').fill(password); await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await mailContext.close();
  await expect(page.locator('#first-shop-title')).toHaveText('Welcome to your workspace');
  await expect(page.locator('.topbar-branch-selector')).toHaveCount(0);
  await expect(page.locator('.dashboard .metric-card')).toHaveCount(0);
  await expect(page.locator('.dashboard').getByRole('link', { name: 'New Booking', exact: true })).toHaveCount(0);
  await page.screenshot({ path: screenshot('first-workspace'), fullPage: true });
  await page.locator('.manager-first-shop a').click();
  await expect(page).toHaveURL(/\/dashboard\/setup\?shop=new$/);
  await page.locator('form.form button[type="submit"]').click();
  await expect(page.locator('#shop-name')).toHaveAttribute('aria-invalid', 'true');
  await page.locator('#shop-name').fill(shopName);
  const governorates = page.locator('#shop-governorateId option'); await expect(governorates).not.toHaveCount(1);
  await page.locator('#shop-governorateId').selectOption(await governorates.nth(1).getAttribute('value'));
  const areas = page.locator('#shop-areaId option'); await expect(areas).not.toHaveCount(1);
  const area = await areas.nth(1).getAttribute('value'); await page.locator('#shop-areaId').selectOption(area);
  await expect(page.locator('#shop-phone')).toBeEmpty();
  await page.locator('form.form button[type="submit"]').click();
  await expect(page).toHaveURL(/\/dashboard\/setup.*step=services/);
  await expect(page.locator('.setup-header p')).toHaveText(shopName);
  await page.reload(); await expect(page.locator('.setup-header p')).toHaveText(shopName);
  await page.goto('/dashboard/branches'); await expect(page.locator('.branch-card-name')).toHaveText(shopName);

  const login = await signIn(email, password); expect(login.ok()).toBe(true);
  const session = await login.json(); expect(session.user.app_metadata.role).toBe('manager');
  const ownHeaders = { ...headers, Authorization: `Bearer ${session.access_token}` };
  const shops = await (await request.get(`${config.supabaseUrl}/rest/v1/branches?select=id,name,manager_id,phone`, { headers: ownHeaders })).json();
  expect(shops).toHaveLength(1); expect(shops[0]).toMatchObject({ name: shopName, manager_id: session.user.id, phone: null });
  const foreign = await request.patch(`${config.supabaseUrl}/rest/v1/branches?id=eq.10000000-0000-4000-8000-000000000001`, { headers: { ...ownHeaders, Prefer: 'return=representation' }, data: { name: 'Not permitted' } });
  expect(foreign.ok()).toBe(true); expect(await foreign.json()).toEqual([]);
  const forgedOwner = await request.post(`${config.supabaseUrl}/rest/v1/branches`, { headers: ownHeaders, data: { name: 'Forbidden owner', manager_id: '00000000-0000-4000-8000-000000000000' } });
  expect(forgedOwner.status()).toBe(403);

  const fresh = await context.browser().newContext({ baseURL: credentials.appUrl, httpCredentials: { username: 'tester', password: credentials.accessPassword, origin: credentials.appUrl } });
  await fresh.addCookies((await context.cookies()).filter(cookie => cookie.name === 'barber_test_access'));
  const freshPage = await fresh.newPage(); await freshPage.goto('/login');
  await freshPage.locator('#email').fill(email); await freshPage.locator('#password').fill(password); await freshPage.locator('button[type="submit"]').click();
  await expect(freshPage).toHaveURL(/\/dashboard$/); await expect(freshPage.locator('.dashboard-welcome-text')).toContainText(shopName);
  await expect(freshPage.locator('#first-shop-title')).toHaveCount(0); await fresh.close();

  // A separate signed-out context verifies collisions without altering the account.
  const duplicateContext = await context.browser().newContext({ baseURL: credentials.appUrl, httpCredentials: { username: 'tester', password: credentials.accessPassword, origin: credentials.appUrl } });
  await duplicateContext.addCookies((await context.cookies()).filter(cookie => cookie.name === 'barber_test_access'));
  const duplicatePage = await duplicateContext.newPage(); await duplicatePage.goto('/signup');
  for (const [id, value] of Object.entries({ name, email, phone: '59998998', password, confirmPassword: password })) await duplicatePage.locator(`#${id}`).fill(value);
  await duplicatePage.locator('button[type="submit"]').click(); await expect(panel(duplicatePage).getByRole('alert')).toContainText('already linked');
  await duplicatePage.locator('#email').fill(`manager-collision-${suffix}@example.test`); await duplicatePage.locator('#phone').fill(phone);
  await duplicatePage.locator('button[type="submit"]').click(); await expect(panel(duplicatePage).getByRole('alert')).toContainText('unregistered phone');
  await duplicateContext.close();
  fs.writeFileSync('.cloud-test/manager-onboarding-fixture.json', JSON.stringify({ email, name, phone, shopName, userId: session.user.id, shopId: shops[0].id, passwordSource: 'existing Test staffPassword', retainedForOwnerReview: true }, null, 2));
});
