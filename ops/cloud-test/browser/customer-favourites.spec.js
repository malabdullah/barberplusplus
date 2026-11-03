import { test, expect, chooseBookingCity } from './fixtures.js';
import fs from 'node:fs';
const path = new URL('../../../.cloud-test/favourites-fixtures.json', import.meta.url);
const fixture = fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, 'utf8')) : null;
const engine = process.env.CLOUD_TEST_BROWSER || 'chromium';
test.use({ browserName: engine });
test.skip(!fixture, 'Requires disposable hosted Test favourites fixtures.');
const heart = (page, name) => page.getByRole('button', { name: `${name} favourite`, exact: true });
const panel = (page, name) => page.locator(`#choose-${name}`);
async function login(page, user) {
  await page.locator('#customer-auth-email').fill(user.email);
  await page.locator('#password').fill(user.password);
  await page.locator('.ca-main').getByRole('button', { name: 'Sign in', exact: true }).click();
}
async function chooseShop(page) {
  await panel(page, 'shop').locator('label.cb-option').filter({ hasText: fixture.shopName }).click();
  await expect(panel(page, 'barber')).toHaveClass(/is-open/);
}
async function noOverflow(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}
test('guest save returns to the booking draft; both favourite types persist and open editable shortcuts', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/book'); await chooseBookingCity(page, fixture.city);
  const shopHeart = heart(page, fixture.shopName);
  await expect(shopHeart).toHaveAttribute('aria-pressed', 'false');
  await shopHeart.click(); await expect(page).toHaveURL(/\/customer\/sign-in\?next=book$/);
  await expect(page.getByText('Sign in to save this favourite.', { exact: false })).toBeVisible();
  await login(page, fixture.users[0]); await expect(page).toHaveURL(/\/book$/);
  await expect(panel(page, 'shop')).toHaveClass(/is-open/);
  await expect(shopHeart).toHaveAttribute('aria-pressed', 'true');
  await chooseShop(page);
  const barberHeart = heart(page, fixture.barberName);
  await barberHeart.click(); await expect(barberHeart).toHaveAttribute('aria-pressed', 'true');
  await expect(panel(page, 'barber')).toHaveClass(/is-open/);
  await page.reload(); await expect(barberHeart).toHaveAttribute('aria-pressed', 'true');
  await noOverflow(page);
  await page.goto('/customer/account');
  await page.locator('main').getByRole('link', { name: 'Favourites', exact: true }).click();
  await expect(page).toHaveURL(/\/customer\/favourites$/);
  const barber = page.getByRole('article').filter({ has: page.getByRole('heading', { name: fixture.barberName, exact: true }) });
  const shop = page.getByRole('region', { name: 'Shops', exact: true }).getByRole('article');
  await expect(barber).toContainText(fixture.shopName);
  await expect(shop).toContainText(fixture.shopName);
  await page.reload(); await expect(barber).toBeVisible(); await expect(shop).toBeVisible();
  const light = page.getByRole('button', { name: 'Switch to light mode' });
  if (await light.isVisible()) await light.click();
  await expect(page.getByRole('button', { name: 'Switch to dark mode' })).toBeVisible();
  await page.locator('.cf-page').screenshot({ path: `.cloud-test/favourites-${engine}-en-light.png`, animations: 'disabled' });
  await shop.getByRole('button', { name: 'Book appointment' }).click();
  await expect(panel(page, 'barber')).toHaveClass(/is-open/);
  await expect(panel(page, 'barber').getByRole('radio', { name: new RegExp(fixture.barberName) })).not.toBeChecked();
  await expect(panel(page, 'shop')).toContainText(fixture.shopName);
  await page.goto('/customer/favourites');
  await barber.getByRole('button', { name: 'Book appointment' }).click();
  await expect(panel(page, 'services')).toHaveClass(/is-open/);
  await expect(panel(page, 'barber')).toContainText(fixture.barberName);
  await expect(panel(page, 'services').getByRole('checkbox')).not.toBeChecked();
  await panel(page, 'city').getByRole('button', { name: /Edit:/ }).click();
  await chooseBookingCity(page, 'Salmiya');
  await expect(panel(page, 'shop')).toHaveClass(/is-open/);
  await expect(panel(page, 'shop').getByRole('radio', { name: /Palm Room/ })).toBeVisible();
  await page.goto('/customer/favourites');
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await page.getByRole('button', { name: 'Select Language' }).click();
  await page.getByRole('button', { name: /العربية/ }).click();
  await expect(page.locator('main')).toContainText('المفضلة');
  await expect(page.locator('.cf-page').locator('..')).toHaveAttribute('dir', 'rtl');
  await noOverflow(page);
  await expect(page.getByRole('heading', { name: 'حلاق المفضلة (اختبار)', exact: true })).toBeVisible();
  await expect(page.locator('.cf-location').first()).toContainText('مدينة الكويت');
  await page.locator('.cf-page').screenshot({ path: `.cloud-test/favourites-${engine}-ar-dark.png`, animations: 'disabled' });
  await page.getByRole('button', { name: /حلاق المفضلة.*المفضلة/ }).click();
  await expect(page.getByRole('heading', { name: 'حلاق المفضلة (اختبار)', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: /صالون الميناء.*المفضلة/ }).click();
  await expect(page.getByRole('heading', { name: 'لا توجد مفضلات بعد' })).toBeVisible();
});
test('leaving the sign-in prompt cancels the save; another account starts with an empty list', async ({ page }) => {
  await page.setViewportSize({ width: 1300, height: 900 });
  await page.goto('/book'); await chooseBookingCity(page, fixture.city); await chooseShop(page);
  await heart(page, fixture.barberName).click(); await expect(page).toHaveURL(/\/customer\/sign-in\?next=book$/);
  await page.getByRole('link', { name: 'Continue as a guest', exact: true }).click();
  await expect(panel(page, 'barber')).toHaveClass(/is-open/);
  await page.goto('/customer/sign-in'); await login(page, fixture.users[1]);
  await expect(page).toHaveURL(/\/customer\/account$/);
  await page.locator('main').getByRole('link', { name: 'Favourites', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No favourites yet' })).toBeVisible();
  await noOverflow(page);
});
