import fs from 'node:fs';
import { test, expect } from './fixtures.js';
const c = JSON.parse(fs.readFileSync('.cloud-test/credentials.json'));
const f = JSON.parse(fs.readFileSync('.cloud-test/wizard-fixture.json'));
const engine = process.env.CLOUD_TEST_BROWSER || 'chromium';
test.use({ browserName: engine });
async function signIn(page) {
  await page.goto('/login'); await page.locator('#email').fill(f.managerEmail); await page.locator('#password').fill(c.staffPassword);
  await page.locator('button[type="submit"]').click(); await expect(page).toHaveURL(/\/dashboard$/);
}
async function catalog(request) {
  const response = await request.post('/test-api/customer-booking', { headers: { Origin: c.appUrl }, data: { action: 'catalog' } });
  expect(response.ok()).toBe(true); return response.json();
}
if (engine === 'chromium') test('manager pauses and republishes a ready shop with public visibility following the saved state', async ({ page, request }) => {
  await signIn(page); await page.goto('/dashboard/branches/' + f.shopId);
  const control = page.locator('.shop-publication');
  await expect(control.getByText('Published', { exact: true })).toBeVisible();
  expect((await catalog(request)).branches.some(shop => shop.id === f.shopId)).toBe(true);
  await control.getByRole('button', { name: 'Pause shop', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(control.getByText('Published', { exact: true })).toBeVisible();
  await control.getByRole('button', { name: 'Pause shop', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Pause shop', exact: true }).click();
  await expect(control.getByText('Paused', { exact: true })).toBeVisible();
  expect((await catalog(request)).branches.some(shop => shop.id === f.shopId)).toBe(false);
  await page.reload(); await expect(control.getByText('Paused', { exact: true })).toBeVisible();
  await control.getByRole('button', { name: 'Publish shop', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Publish shop', exact: true }).click();
  await expect(control.getByText('Published', { exact: true })).toBeVisible();
  expect((await catalog(request)).branches.some(shop => shop.id === f.shopId)).toBe(true);
});
if (engine === 'chromium') test('new manager shop remains draft with publishing disabled until setup is ready', async ({ page, request }) => {
  await signIn(page); await page.goto('/dashboard/setup?shop=new');
  const name = 'Publishing Draft QA ' + Date.now();
  await page.locator('#shop-name').fill(name);
  await page.locator('#shop-governorateId option').nth(1).waitFor({ state: 'attached' });
  await page.locator('#shop-governorateId').selectOption(await page.locator('#shop-governorateId option').nth(1).getAttribute('value'));
  await page.locator('#shop-areaId option').nth(1).waitFor({ state: 'attached' });
  await page.locator('#shop-areaId').selectOption(await page.locator('#shop-areaId option').nth(1).getAttribute('value'));
  await page.getByRole('button', { name: 'Save and continue', exact: true }).click();
  await expect(page.locator('#service-name')).toBeVisible();
  const id = new URL(page.url()).searchParams.get('shop');
  await page.goto('/dashboard/setup?shop=' + id + '&step=review');
  await expect(page.locator('.shop-publication').getByText('Draft', { exact: true })).toBeVisible();
  await expect(page.locator('.shop-publication').getByRole('button', { name: 'Publish shop', exact: true })).toBeDisabled();
  expect((await catalog(request)).branches.some(shop => shop.id === id)).toBe(false);
  fs.writeFileSync('.cloud-test/publishing-fixture.json', JSON.stringify({ shopId: id, name, retainedForReview: true }, null, 2), { mode: 0o600 });
});
for (const language of ['en', 'ar']) for (const theme of ['light', 'dark']) test('publishing layout ' + language + ' ' + theme, async ({ page }) => {
  await page.addInitScript(({ language, theme }) => { localStorage.setItem('i18nextLng', language); localStorage.setItem('theme', theme); }, { language, theme });
  await page.setViewportSize({ width: 360, height: 800 }); await signIn(page);
  await page.goto('/dashboard/setup?shop=' + f.shopId + '&step=review');
  await expect(page.locator('.shop-publication button')).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: '.cloud-test/publishing-' + engine + '-' + language + '-' + theme + '.png', fullPage: true });
});
