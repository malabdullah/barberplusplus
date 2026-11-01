import { expect, test } from '@playwright/test';

for (const [role, home] of [['admin', '/admin'], ['manager', '/dashboard'], ['agent', '/agent'], ['barber', '/barber']]) {
  test(`${role} Test banner leaves navigation and drawer controls unobscured`, async ({ page }) => {
    test.setTimeout(120000);
    const base = new URL(test.info().project.use.baseURL || 'http://127.0.0.1:4173');
    expect(['localhost', '127.0.0.1', '::1']).toContain(base.hostname);
    const localApi = new URL('http://127.0.0.1:55321');
    const runtime = { environment: 'test', appUrl: base.origin,
      supabaseUrl: 'http://127.0.0.1:55321', supabasePublishableKey: process.env.VITE_SUPABASE_PUBLISHABLE_KEY, release: 'local-banner-regression' };
    expect(runtime.supabasePublishableKey).toBeTruthy();
    await page.addInitScript(value => { window.__BARBER_CONFIG__ = Object.freeze(value); }, runtime);
    await page.goto('/login');
    await expect(page.getByRole('status')).toContainText('TEST — synthetic data');
    await page.getByLabel('Email address', { exact: true }).fill(`${role}@barber.test`);
    await page.getByLabel('Password', { exact: true }).fill('LocalOnly123!');
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(new RegExp(`${home}(?:/|$)`));
    const heightBefore = await page.locator('.environment-banner').evaluate(element => element.getBoundingClientRect().height);
    await page.locator('.environment-banner').evaluate(element => { element.style.fontSize = '2rem'; });
    await expect.poll(() => page.evaluate(() => parseFloat(document.documentElement.style.getPropertyValue('--environment-banner-height')))).toBeGreaterThan(heightBefore);
    await page.locator('.environment-banner').evaluate(element => { element.style.removeProperty('font-size'); });
    for (const language of ['en', 'ar']) {
      await page.locator('.preferences-selector').first().locator('button').first().click();
      await page.getByRole('button', { name: language === 'ar' ? 'العربية' : 'English', exact: true }).click();
      for (const width of [360, 390, 430, 768, 1024, 1365]) {
        await page.setViewportSize({ width, height: 844 });
        const visibleControls = page.locator('.topbar button:visible');
        for (const button of await visibleControls.all()) {
          // The mobile drawer animates above the top bar after a resize or close.
          // Keep the hit test, but allow that transition to finish before asserting.
          await expect.poll(() => button.evaluate(element => {
            const box = element.getBoundingClientRect(); const banner = document.querySelector('.environment-banner').getBoundingClientRect();
            return box.top >= banner.bottom - 1 && element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
          }), { message: `${role} top-bar control is unobscured at ${width}px (${language})` }).toBe(true);
        }
        if (width <= 1024) {
          await page.getByRole('button', { name: language === 'en' ? 'Navigation' : 'التنقل', exact: true }).click();
          const close = page.locator('.sidebar-close-btn');
          await expect(close).toBeFocused();
          expect(await close.evaluate(element => element.getBoundingClientRect().top >= document.querySelector('.environment-banner').getBoundingClientRect().bottom - 1)).toBe(true);
          await close.click();
          await expect(page.locator('aside.sidebar')).toHaveAttribute('inert', '');
        }
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: test.info().outputPath(`${role}-test-banner-rtl.png`) });
  });
}
