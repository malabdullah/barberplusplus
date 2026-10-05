import { expect, test } from '@playwright/test';

const password = 'LocalOnly123!';

async function login(page, email, expectedPath) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(new RegExp(`${expectedPath.replace('/', '\\/')}(?:\\/|$)`));
}

test('administrator reaches only the administrator workspace', async ({ page }) => {
  await login(page, 'admin@barber.test', '/admin');
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/admin(?:\/|$)/);
});

test('manager sees only their own tenant branch', async ({ page }) => {
  await login(page, 'manager@barber.test', '/dashboard');
  await page.goto('/dashboard/branches');
  await expect(page.locator('.branch-card-name', { hasText: 'Synthetic Branch' })).toBeVisible();
  await expect(page.locator('.branch-card-name', { hasText: 'Other Tenant Branch' })).toHaveCount(0);
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/dashboard(?:\/|$)/);
});

test('agent reaches only the agent workspace', async ({ page }) => {
  await login(page, 'agent@barber.test', '/agent');
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/agent(?:\/|$)/);
});

test('barber reaches only the barber workspace', async ({ page }) => {
  await login(page, 'barber@barber.test', '/barber');

  const authorization = await page.evaluate(async ({ fallbackKey }) => {
    const sessionKey = Object.keys(localStorage).find((key) => key.startsWith('sb-') && key.endsWith('-auth-token'));
    const session = sessionKey ? JSON.parse(localStorage.getItem(sessionKey)) : null;
    const accessToken = session?.access_token;
    const runtime = window.__BARBER_CONFIG__;
    const supabaseUrl = runtime?.supabaseUrl || 'http://127.0.0.1:54321';
    const publishableKey = runtime?.supabasePublishableKey || fallbackKey;
    const headers = {
      apikey: publishableKey,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    };

    const ownResponse = await fetch(
      `${supabaseUrl}/rest/v1/branches?select=id&id=eq.10000000-0000-4000-8000-000000000001`,
      { headers }
    );
    const otherResponse = await fetch(
      `${supabaseUrl}/rest/v1/branches?select=id&id=eq.10000000-0000-4000-8000-000000000002`,
      { headers }
    );
    const forbiddenUpdate = await fetch(
      `${supabaseUrl}/rest/v1/branches?id=eq.10000000-0000-4000-8000-000000000002`,
      { method: 'PATCH', headers, body: JSON.stringify({ name: 'Forbidden cross-tenant update' }) }
    );

    return {
      ownStatus: ownResponse.status,
      ownRows: await ownResponse.json(),
      otherStatus: otherResponse.status,
      otherRows: await otherResponse.json(),
      updateStatus: forbiddenUpdate.status,
      updatedRows: await forbiddenUpdate.json(),
    };
  }, { fallbackKey: process.env.VITE_SUPABASE_PUBLISHABLE_KEY });

  expect(authorization.ownStatus).toBe(200);
  expect(authorization.ownRows).toHaveLength(1);
  expect(authorization.otherStatus).toBe(200);
  expect(authorization.otherRows).toHaveLength(0);
  expect(authorization.updateStatus).toBe(200);
  expect(authorization.updatedRows).toHaveLength(0);

  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/barber(?:\/|$)/);
});
