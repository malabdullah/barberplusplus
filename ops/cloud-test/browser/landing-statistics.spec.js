import { test, expect } from './fixtures.js';

for (const language of ['en', 'ar']) {
  test(`live landing statistics and immediate theme toggle in ${language}`, async ({ page, request }) => {
    await page.setViewportSize({width:465,height:827});
    await page.addInitScript(language => {
      localStorage.setItem('barber-language',language);
      localStorage.setItem('barber-theme','light');
    },language);
    const response = await request.post('/test-api/customer-booking',{data:{action:'statistics'}});
    expect(response.ok()).toBe(true);
    const counts = await response.json();
    expect(Object.keys(counts).sort()).toEqual(['barbers','monthlyBookings','shops']);
    await page.goto('/');
    const values = page.locator('.hero-stat-value');
    const expected = ['shops','monthlyBookings','barbers'].map(key => new Intl.NumberFormat(language).format(counts[key]));
    await expect(values).toHaveText(expected);
    const theme = page.locator('.public-header .preferences-selector').nth(1).locator('button');
    await theme.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
    await expect(page.locator('.preferences-dropdown')).toHaveCount(0);
    await expect(page.locator('#benefits-title .brand-logo-dark')).toHaveAttribute('src','/brand/barber-symbol-dark.svg');
    await expect(page.locator('#benefits-title')).not.toHaveText(/Barber\+\+/);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
    await theme.press('Enter');
    await expect(page.locator('html')).toHaveAttribute('data-theme','light');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
}

test('statistics distinguish actual zero counts from an unavailable backend', async ({ page }) => {
  let unavailable = false;
  await page.route('**/test-api/customer-booking', async route => {
    if (route.request().postDataJSON()?.action !== 'statistics') return route.continue();
    await route.fulfill({status:unavailable ? 503 : 200,contentType:'application/json',body:JSON.stringify(unavailable ? {error:'UNAVAILABLE'} : {shops:0,monthlyBookings:0,barbers:0})});
  });
  await page.goto('/');
  await expect(page.locator('.hero-stat-value')).toHaveText(['0','0','0']);
  unavailable = true;
  await page.reload();
  await expect(page.locator('.hero-stat-value')).toHaveText(['—','—','—']);
  await expect(page.locator('.hero-stats-unavailable')).toBeVisible();
});
