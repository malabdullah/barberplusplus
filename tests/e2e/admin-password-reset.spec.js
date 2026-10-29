import { expect, test } from '@playwright/test';

const synthetic = { id: '20000000-0000-4000-8000-000000000002', email: 'user@barber.test', role: 'manager' };

test('administrator can select a non-admin and submit a temporary password', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('admin@barber.test');
  await page.getByLabel('Password').fill('LocalOnly123!');
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/admin/);
  let resets = 0;
  await page.route('**/functions/v1/admin-password-reset', async route => {
    const headers = { 'Access-Control-Allow-Origin': new URL(page.url()).origin, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type':'application/json' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({status:204,headers});
    const body = route.request().postDataJSON();
    if (body.action === 'list') return route.fulfill({status:200,headers,json:{users:[synthetic],hasMore:false}});
    expect(body.userId).toBe(synthetic.id); expect(body.password).toBe('TemporaryPass123!'); resets += 1;
    return route.fulfill({status:200,headers,json:{success:true,auditComplete:true}});
  });
  await page.setViewportSize({width:390,height:844});
  await page.goto('/admin/users/passwords');
  await expect(page.locator('.admin-page-header h1')).toBeVisible();
  await page.locator('#reset-user').selectOption(synthetic.id);
  await page.locator('#reset-password').fill('TemporaryPass123!');
  await page.locator('#reset-confirm').fill('TemporaryPass123!');
  await page.locator('.password-reset-form button[type="submit"]').click();
  await expect(page.locator('.password-reset-form [role="status"]')).toBeVisible();
  await expect(page.locator('#reset-password')).toHaveValue('');
  expect(resets).toBe(1);
});

test('non-admin users cannot open the admin reset page', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('manager@barber.test');
  await page.getByLabel('Password').fill('LocalOnly123!');
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.goto('/admin/users/passwords');
  await expect(page).toHaveURL(/\/dashboard(?:\/|$)/);
  await page.goto('/dashboard/settings');
  await page.locator('.settings-link-btn').filter({hasText:/Change Password|تغيير كلمة المرور/i}).click();
  await expect(page).toHaveURL(/\/change-password$/);
  await expect(page.locator('#own-password')).toBeVisible();
});
