import { expect, test } from '@playwright/test';

// Await in-flight fixture forwarding before Playwright closes its request context.
test.afterEach(async ({ context }) => {
  await context.unrouteAll({ behavior: 'wait' });
});

for (const [role, home] of [['admin', '/admin'], ['manager', '/dashboard'], ['agent', '/agent'], ['barber', '/barber']]) {
  test(`${role} Test banner leaves navigation and drawer controls unobscured`, async ({ page, context }) => {
    test.setTimeout(120000);
    const base = new URL(test.info().project.use.baseURL || 'http://127.0.0.1:4173');
    expect(['localhost', '127.0.0.1', '::1']).toContain(base.hostname);
    const localApi = new URL(process.env.BARBER_QA_API || 'http://127.0.0.1:54321');
    expect(['127.0.0.1', 'localhost']).toContain(localApi.hostname);
    const runtime = { environment: 'staging', appUrl: 'https://barber-test-ui.invalid',
      supabaseUrl: 'https://barber-test-api.invalid', supabasePublishableKey: process.env.VITE_SUPABASE_PUBLISHABLE_KEY, release: 'local-banner-regression' };
    expect(runtime.supabasePublishableKey).toBeTruthy();
    // Exercise the real Test-only component, but proxy only to isolated local
    // fixtures. Neither .invalid origin is contacted; no live Test credentials.
    await context.route('https://barber-test-api.invalid/**', async route => {
      const requested = new URL(route.request().url());
      expect(requested.origin).toBe(runtime.supabaseUrl);
      const response = await route.fetch({url: new URL(requested.pathname + requested.search, localApi).href,
        headers: { ...route.request().headers(), host: localApi.host }, maxRedirects: 0,
      });
      await route.fulfill({ response, headers: { ...response.headers(), 'access-control-allow-origin': base.origin } });
    });
    await context.routeWebSocket('wss://barber-test-api.invalid/**', socket => socket.close());
    // The served local asset runs after addInitScript; keep this fixture authoritative.
    await context.route(new URL('/runtime-config.js', base).href, route => route.fulfill({
      contentType: 'application/javascript', body: 'window.__BARBER_CONFIG__ = ' + JSON.stringify(runtime) + ';',
    }));
    await page.addInitScript(value => { window.__BARBER_CONFIG__ = Object.freeze(value); }, runtime);
    await page.goto('/login');
    await expect(page.getByRole('status')).toContainText('TEST — synthetic data');
    await page.getByLabel('Email', { exact: true }).fill(`${role}@barber.test`);
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
          expect(await button.evaluate(element => {
            const box = element.getBoundingClientRect(); const banner = document.querySelector('.environment-banner').getBoundingClientRect();
            return box.top >= banner.bottom - 1 && element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
          })).toBe(true);
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
