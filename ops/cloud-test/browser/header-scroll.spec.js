import { test, expect } from './fixtures.js';
import fs from 'node:fs';

test.use({ browserName: process.env.CLOUD_TEST_BROWSER || 'chromium' });
const credentials = JSON.parse(fs.readFileSync(new URL('../../../.cloud-test/credentials.json', import.meta.url)));

async function expectJoinedHeader(page, selector) {
  await expect.poll(() => page.evaluate(selector => {
    const banner = document.querySelector('.environment-banner').getBoundingClientRect();
    const header = document.querySelector(selector).getBoundingClientRect();
    return Math.abs(banner.top) < 1 && Math.abs(header.top - banner.bottom) < 1;
  }, selector), { message: 'Test banner stays at the viewport top with the header directly below' }).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}

async function exerciseScroll(page, selector) {
  for (const y of [600, 1200, 300, 0]) {
    await page.evaluate(y => window.scrollTo({ top: y, behavior: 'instant' }), y);
    await expectJoinedHeader(page, selector);
  }
  await page.evaluate(() => window.scrollTo({ top: 600, behavior: 'instant' }));
  expect(await page.evaluate(() => scrollY)).toBeGreaterThan(100);
  await expectJoinedHeader(page, selector);
}

for (const language of ['en', 'ar']) {
  test(`public headers stay joined while scrolling in ${language}`, async ({ page }) => {
    await page.addInitScript(language => localStorage.setItem('barber-language', language), language);
    for (const width of [360, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      for (const route of ['/', '/book', '/customer/sign-up']) {
        await page.goto(route);
        // The public shell renders before lazy route content becomes scrollable.
        await expect(page.locator('.public-content main, .public-content .hero-section').first()).toBeVisible();
        await expect(page.locator('html')).toHaveAttribute('dir', language === 'ar' ? 'rtl' : 'ltr');
        await exerciseScroll(page, '.public-header');
        if (width === 360) {
          const toggle = page.locator('.public-mobile-toggle');
          await toggle.click();
          await expect(toggle).toHaveAttribute('aria-expanded', 'true');
          await expectJoinedHeader(page, '.public-header');
          await expect(page.locator('#public-mobile-links').getByRole('link').last()).toBeInViewport();
          await page.keyboard.press('Escape');
          await expect(toggle).toHaveAttribute('aria-expanded', 'false');
          await expectJoinedHeader(page, '.public-header');
        }
      }
    }
  });
}

for (const [role, home] of [['admin', '/admin'], ['manager', '/dashboard'], ['agent', '/agent'], ['barber', '/barber']]) {
  test(`${role} header and drawer stay joined while scrolling`, async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('barber-language', 'en'));
    await page.goto('/login');
    await page.getByLabel('Email address', { exact: true }).fill(`${role}@barber.test`);
    await page.getByLabel('Password', { exact: true }).fill(credentials.staffPassword);
    const settings = page.waitForResponse(response => response.url().includes('/rest/v1/user_settings?') && response.ok());
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(new RegExp(home + '(?:/|$)'));
    await settings;
    await page.goto(`${home}/settings`);
    await expect(page.locator('.topbar')).toBeVisible();
    for (const width of [360, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      for (const language of ['en', 'ar']) {
        await page.locator('.topbar .preferences-selector').first().locator('button').first().click();
        await page.getByRole('button', { name: language === 'ar' ? 'العربية' : 'English', exact: true }).click();
        await expect(page.locator('html')).toHaveAttribute('dir', language === 'ar' ? 'rtl' : 'ltr');
        const theme = page.locator('.topbar .preferences-selector').nth(1).locator('button').first();
        await theme.click();
        await exerciseScroll(page, '.topbar');
        if (width === 360) {
          await page.locator('.topbar-menu-btn').click();
          await expect(page.locator('aside.sidebar')).toHaveAttribute('role', 'dialog');
          await expectJoinedHeader(page, '.topbar');
          expect(await page.locator('aside.sidebar').evaluate(el => Math.abs(el.getBoundingClientRect().top - document.querySelector('.environment-banner').getBoundingClientRect().bottom) < 1)).toBe(true);
          await page.keyboard.press('Escape');
          await expect(page.locator('aside.sidebar')).not.toHaveAttribute('role', 'dialog');
        }
      }
    }
    // Wrapped/zoomed banner text must update the shared offset after scrolling.
    await page.locator('.environment-banner').evaluate(el => { el.style.fontSize = '2rem'; });
    await expectJoinedHeader(page, '.topbar');
    await page.locator('.environment-banner').evaluate(el => { el.style.removeProperty('font-size'); });
    await expectJoinedHeader(page, '.topbar');
    if (role === 'manager') {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: '.cloud-test/header-scroll-fixed.png' });
    }
  });
}
