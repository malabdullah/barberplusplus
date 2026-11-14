import { test, expect } from './fixtures.js';
import fs from 'node:fs';
import ExcelJS from 'exceljs';

test.use({ actionTimeout: 20000 });
const qa = JSON.parse(fs.readFileSync(process.env.REPORTS_QA_FILE || '.cloud-test/reports-qa.json'));
async function login(page, email) {
  await page.goto('/login');
  await page.getByLabel('Email address', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(qa.password);
  const preferences = page.waitForResponse(response => response.url().includes('/rest/v1/user_settings?') && response.request().method() === 'GET');
  await page.locator('button[type="submit"]').click();
  await expect(page).not.toHaveURL(/\/login/);
  await preferences;
  if (await page.locator('html').getAttribute('dir') === 'rtl') {
    await page.locator('.preferences-selector').first().locator('button').first().click();
    const saved = page.waitForResponse(response => response.url().includes('/rest/v1/user_settings') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'English', exact: true }).click(); await saved;
  }
}
async function generate(page) {
  await page.getByRole('button', { name: 'Generate report', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Period at a glance' })).toBeVisible({ timeout: 60000 });
  await expect(page.getByRole('alert')).toHaveCount(0);
}

test('manager report types, detail pagination, exact Excel snapshot and dirty filters', async ({ page }) => {
  const errors = [];
  await login(page, qa.users.manager.email);
  await page.goto('/dashboard/reports');
  await expect(page.getByRole('heading', { name: 'Reports', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Generate report', exact: true })).toBeEnabled();
  // Observe this screen after login/navigation has settled. WebKit reports
  // aborted requests from the document being replaced as page errors.
  page.on('pageerror', error => errors.push(error.message));
  await expect(page.getByRole('button', { name: 'Export Excel', exact: true })).toBeDisabled();
  await generate(page);
  await page.getByRole('button', { name: 'View appointments', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Appointments', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeVisible();
  await expect(page.getByText('common.close', { exact: true })).toHaveCount(0);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Excel', exact: true }).click();
  const file = await download;
  const path = await file.path();
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.readFile(path);
  expect(workbook.worksheets.map(sheet => sheet.name)).toEqual(['Summary', 'Breakdown', 'Appointments', 'Definitions']);
  const sheet = workbook.getWorksheet('Appointments');
  expect(sheet.views[0].ySplit).toBe(1);
  expect(sheet.getRow(1).values.join(' ')).not.toMatch(/email|phone/i);
  for (const row of sheet.getRows(2, Math.max(0, sheet.rowCount - 1)) || []) expect(row.getCell(9).type).toBe(ExcelJS.ValueType.Number);
  await page.getByRole('combobox', { name: 'Period', exact: true }).first().selectOption('lastMonth');
  await expect(page.getByRole('button', { name: 'Export Excel', exact: true })).toBeDisabled();
  await expect(page.getByText('Filters changed. Generate a new report to update these results.')).toBeVisible();
  for (const type of ['shops', 'barbers', 'services', 'customers', 'demand', 'ratings', 'bookings']) {
    await page.getByRole('combobox', { name: 'Report', exact: true }).first().selectOption(type);
    await generate(page);
  }
  await page.getByRole('combobox', { name: 'Report', exact: true }).first().selectOption('shops');
  await generate(page);
  await page.getByRole('button', { name: 'View shop', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Barber performance', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Report', exact: true }).first().selectOption('personal');
  await generate(page);
  await expect(page.getByText('Completed booking value', { exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Report', exact: true }).first().selectOption('overview');
  await generate(page);
  if (await page.locator('html').getAttribute('data-theme') !== 'light') await page.getByRole('button', { name: 'Switch to light mode', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.screenshot({ path: '.cloud-test/reports-manager.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('barber has only personal metrics and own export', async ({ page }) => {
  await login(page, qa.users.barber.email);
  await page.goto('/barber/performance');
  await expect(page.getByRole('heading', { name: 'My performance', exact: true })).toBeVisible();
  await expect(page.getByRole('option', { name: 'Shops', exact: true })).toHaveCount(0);
  await expect(page.getByRole('option', { name: 'Barbers', exact: true })).toHaveCount(0);
  await generate(page);
  await expect(page.getByText('Completed booking value', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Shop performance' })).toHaveCount(0);
  await page.screenshot({ path: '.cloud-test/reports-barber.png', fullPage: true });
  await page.getByRole('combobox', { name: 'Report', exact: true }).first().selectOption('ratings');
  await generate(page);
  await expect(page.getByRole('heading', { name: 'Ratings', exact: true })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Shop rating', exact: true })).toBeVisible();
});

test('mobile filters, dark theme and Arabic keep amounts within the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, qa.users.manager.email);
  await page.goto('/dashboard/reports');
  await expect(page.getByRole('button', { name: 'Generate report', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await expect(page.locator('dialog')).toHaveAttribute('open', '');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('dialog').getByRole('combobox', { name: 'Period', exact: true }).selectOption('lastMonth');
  await page.getByRole('dialog').getByRole('button', { name: 'Generate report', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('heading', { name: 'Period at a glance' })).toBeVisible({ timeout: 60000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: '.cloud-test/reports-mobile-en.png', fullPage: true });
  // This isolated QA context owns these preferences; owner browser is untouched.
  await page.getByRole('button', { name: /Switch to (light|dark) mode/ }).click();
  await page.getByRole('button', { name: /language/i }).click();
  await page.getByRole('button', { name: /العربية/ }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: '.cloud-test/reports-mobile-ar.png', fullPage: true });
});

// Restore only these dedicated QA accounts' preferences, never owner sessions.
test('personal performance clears a previously selected shop scope', async ({ page }) => {
  await login(page, qa.users.manager.email);
  await page.goto('/dashboard/reports');
  await page.getByRole('combobox', { name: 'Report', exact: true }).first().selectOption('shops');
  await page.getByRole('combobox', { name: 'Period', exact: true }).first().selectOption('lastMonth');
  await generate(page);
  await page.getByRole('button', { name: 'View shop', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Barber performance', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Report', exact: true }).first().selectOption('personal');
  const request = page.waitForRequest(request => request.url().endsWith('/test-api/staff-reports') && request.method() === 'POST');
  await generate(page);
  expect((await request).postDataJSON()).toMatchObject({ personal: true, shopIds: [] });
});

test.afterEach(async ({ page }) => {
  if (page.isClosed() || !page.url().includes('/dashboard/reports')) return;
  const selectors = page.locator('.preferences-selector');
  if (!await selectors.count()) return;
  if (await page.locator('html').getAttribute('dir') === 'rtl') {
    await selectors.first().locator('button').first().click();
    const saved = page.waitForResponse(response => response.url().includes('/rest/v1/user_settings') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'English', exact: true }).click(); await saved;
  }
  if (await page.locator('html').getAttribute('data-theme') !== 'dark') await page.getByRole('button', { name: 'Switch to dark mode', exact: true }).click();
});
