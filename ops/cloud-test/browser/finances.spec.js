import { test, expect } from './fixtures.js';
import fs from 'node:fs';
import ExcelJS from 'exceljs';
const qa = JSON.parse(fs.readFileSync('.cloud-test/reports-qa.json'));
const fixture = JSON.parse(fs.readFileSync('.cloud-test/finance-fixture.json'));
async function login(page, role = 'manager') {
  await page.goto('/login');
  await page.getByLabel('Email address', { exact: true }).fill(qa.users[role].email);
  await page.getByLabel('Password', { exact: true }).fill(qa.password);
  await page.locator('button[type="submit"]').click();
  await expect(page).not.toHaveURL(/\/login/);
}
async function ready(page) {
  await login(page); await page.goto('/dashboard/finances');
  await expect(page.getByRole('heading', { name: 'Finances', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Shops', exact: true })).toBeEnabled();
  await page.getByRole('combobox', { name: 'Shops', exact: true }).selectOption(fixture.shop);
}
const record = (page, id) => page.locator('.finance-record').filter({ has: page.locator('code', { hasText: id.slice(0, 8) }) });
async function save(page, amount, reason) {
  const dialog = page.getByRole('dialog');
  if (amount !== undefined) await dialog.getByLabel('Amount (KWD)', { exact: true }).fill(amount);
  if (reason) await dialog.getByLabel('Reason', { exact: true }).fill(reason);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
}
async function generate(page) {
  await page.getByRole('button', { name: 'Generate report', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Recorded operating result', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
}
test('manual partial payments, refunds, correction safeguards, expenses and exact Excel totals', async ({ page }) => {
  await ready(page);
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.getByRole('button', { name: 'Booking payments', exact: true }).click();
  await expect(record(page, fixture.completed)).toBeVisible();
  await record(page, fixture.completed).getByRole('button', { name: 'Record payment', exact: true }).click();
  await save(page, '60'); await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(record(page, fixture.completed)).toContainText('60.000');
  await record(page, fixture.completed).getByRole('button', { name: 'Record payment', exact: true }).click();
  await save(page, '41'); await expect(page.getByRole('alert')).toContainText('exceeds the amount due');
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await record(page, fixture.completed).getByRole('button', { name: 'Record refund', exact: true }).click();
  await save(page, '5', 'QA partial refund'); await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(record(page, fixture.completed)).toContainText('55.000');
  await record(page, fixture.completed).getByRole('button', { name: 'Payment history', exact: true }).click();
  const refund = page.locator('.finance-history').filter({ hasText: 'Customer refund' });
  await expect(refund).toContainText('5.000');
  await refund.getByRole('button', { name: 'Correct entry', exact: true }).click();
  await save(page, undefined, 'QA refund recorded by mistake'); await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(record(page, fixture.completed)).toContainText('60.000');
  await expect(record(page, fixture.cancelled).getByRole('button', { name: 'Record payment', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Expenses', exact: true }).click();
  async function expense(description) {
    await page.getByRole('button', { name: 'Add expense', exact: true }).click();
    await page.getByRole('dialog').getByLabel('Description', { exact: true }).fill(description);
    await save(page, '30'); await expect(page.getByRole('dialog')).not.toBeVisible();
    return page.locator('.finance-record').filter({ has: page.getByRole('heading', { name: description, exact: true }) });
  }
  const first = await expense('Finance QA duplicate supplies');
  await first.getByRole('button', { name: 'Record expense payment', exact: true }).click();
  await save(page, '10'); await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(first).toContainText('20.000');
  await expect(first.getByRole('button', { name: 'Void expense', exact: true })).toHaveCount(0);
  await first.getByRole('button', { name: 'Record expense payment', exact: true }).click();
  await save(page, '21'); await expect(page.getByRole('alert')).toContainText('exceeds the amount due');
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await first.getByRole('button', { name: 'Payment history', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Correct entry', exact: true }).click();
  await save(page, undefined, 'QA duplicate payment correction'); await expect(page.getByRole('dialog')).not.toBeVisible();
  await first.getByRole('button', { name: 'Void expense', exact: true }).click();
  await save(page, undefined, 'QA duplicate expense'); await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(first).toContainText('Voided');
  const second = await expense('Finance QA rent');
  await second.getByRole('button', { name: 'Record expense payment', exact: true }).click();
  await save(page, '10'); await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await generate(page);
  await page.screenshot({ path: '.cloud-test/finances-manager.png', fullPage: true });
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Excel', exact: true }).click();
  const book = new ExcelJS.Workbook(); await book.xlsx.readFile(await (await download).path());
  expect(book.worksheets.map(s => s.name)).toEqual(['Summary', 'Shops', 'Entries', 'Definitions']);
  const summary = Object.fromEntries(book.worksheets[0].getRows(2, book.worksheets[0].rowCount - 1).map(r => [r.getCell(1).value, r.getCell(2).value]));
  expect(summary['Completed sales']).toBe(100); expect(summary['Expenses incurred']).toBe(30);
  expect(summary['Recorded operating result']).toBe(70); expect(summary['Net cash flow']).toBe(50);
  expect(summary['Customer amounts due']).toBe(60); expect(summary['Unpaid expenses']).toBe(20);
  expect(book.worksheets[2].getCell('E2').type).toBe(ExcelJS.ValueType.Number);
  expect(book.worksheets[2].getRow(1).values.join(' ')).not.toMatch(/email|phone/i);
  await page.getByLabel('From', { exact: true }).fill('2026-10-01');
  await expect(page.getByRole('button', { name: 'Export Excel', exact: true })).toBeDisabled();
  expect(errors).toEqual([]);
});
test('mobile and Arabic, dark/light, dialog controls and responsive tables', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await ready(page); await generate(page);
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 402, height: 874 }, { width: 874, height: 402 }, { width: 768, height: 1024 }]) {
    await page.setViewportSize(viewport);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: /Switch to (light|dark) mode/ }).click();
  await page.screenshot({ path: '.cloud-test/finances-mobile-en.png', fullPage: true });
  await page.getByRole('button', { name: /language/i }).click(); await page.getByRole('button', { name: /العربية/ }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.cloud-test/finances-mobile-ar.png', fullPage: true });
  await page.getByRole('button', { name: 'المصروفات', exact: true }).click();
  await page.getByRole('button', { name: 'إضافة مصروف', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'حفظ', exact: true })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).not.toBeVisible();
});
test('barber retains personal performance and cannot open manager finance page', async ({ page }) => {
  await login(page, 'barber'); await page.goto('/barber/performance');
  await expect(page.getByRole('heading', { name: 'My performance', exact: true })).toBeVisible();
  await expect(page.locator('a[href="/dashboard/finances"]')).toHaveCount(0);
  await page.goto('/dashboard/finances'); await expect(page).not.toHaveURL(/\/dashboard\/finances/);
});
test.afterEach(async ({ page }) => {
  if (page.isClosed() || !page.url().includes('/dashboard/finances')) return;
  const selectors = page.locator('.preferences-selector');
  if (await page.locator('html').getAttribute('dir') === 'rtl') { await selectors.first().locator('button').first().click(); await page.getByRole('button', { name: 'English', exact: true }).click(); }
  if (await page.locator('html').getAttribute('data-theme') !== 'dark') await page.getByRole('button', { name: 'Switch to dark mode', exact: true }).click();
});
