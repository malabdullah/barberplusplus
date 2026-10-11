import { expect, test } from '@playwright/test';

const roles = [['admin', '/admin'], ['manager', '/dashboard'], ['agent', '/agent'], ['barber', '/barber']];
const sizes = [[360, 800], [390, 844], [430, 932], [768, 1024], [1023, 900], [1024, 900], [1025, 900], [1365, 900]];
for (const [role, home] of roles) {
  test(`${role} navigation across responsive, language and theme states`, async ({ page }) => {
    test.setTimeout(180000);
    // Development-only fixtures. Live staging tests use protected VPS fixtures.
    const base = new URL(test.info().project.use.baseURL || 'http://127.0.0.1:4173');
    expect(['localhost', '127.0.0.1', '::1']).toContain(base.hostname);
    await page.goto('/login');
    await page.getByLabel('Email', { exact: true }).fill(`${role}@barber.test`);
    await page.getByLabel('Password', { exact: true }).fill('LocalOnly123!');
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(new RegExp(`${home}(?:/|$)`));
    const original = await page.evaluate(() => ({ language: localStorage.getItem('barber-language') || 'en', theme: localStorage.getItem('barber-theme') || 'dark' }));
    try {
    for (const language of ['en', 'ar']) {
      await page.locator('.preferences-selector').first().locator('button').first().click();
      await page.getByRole('button', { name: language === 'ar' ? 'العربية' : 'English', exact: true }).click();
      await expect(page.locator('html')).toHaveAttribute('dir', language === 'ar' ? 'rtl' : 'ltr');
      for (const theme of ['dark', 'light']) {
        await page.locator('.preferences-selector').nth(1).locator('button').first().click();
        const label = language === 'en' ? (theme === 'dark' ? 'Dark' : 'Light') : (theme === 'dark' ? 'داكن' : 'فاتح');
        await page.locator('.preferences-option').filter({ hasText: label }).click();
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        for (const [width, height] of sizes) {
          await page.setViewportSize({ width, height });
          const sidebar = page.locator('aside.sidebar');
          const mobile = await page.evaluate(() => window.matchMedia('(max-width: 1024px)').matches);
          if (mobile) {
            await expect(sidebar).toHaveAttribute('inert', '');
            const menu = page.locator('.topbar-menu-btn'); await menu.click();
            await expect(sidebar).toHaveAttribute('role', 'dialog');
            await expect(sidebar).not.toHaveAttribute('inert');
            await expect(page.locator('.layout-main')).toHaveAttribute('inert', '');
            await expect(sidebar.locator('.sidebar-close-btn')).toBeFocused();
            await expect.poll(async () => {
              const bounds = await sidebar.boundingBox();
              return bounds.x >= -1 && bounds.x + bounds.width <= width + 1;
            }).toBe(true);
            const links = sidebar.locator('a[href]');
            const last = sidebar.locator('button').last(); await last.focus(); await page.keyboard.press('Tab');
            await expect(sidebar.locator('.sidebar-close-btn')).toBeFocused();
            await page.keyboard.press('Escape'); await expect(sidebar).toHaveAttribute('inert', '');
            await expect(menu).toBeFocused();
            await menu.click();
            const rtl = await page.locator('html').getAttribute('dir') === 'rtl';
            const overlay = page.locator('.sidebar-overlay');
            const overlayBounds = await overlay.boundingBox();
            // WebKit's non-overlay scrollbar reduces the clickable box width.
            await overlay.click({ position: { x: rtl ? 5 : overlayBounds.width - 5, y: Math.min(400, overlayBounds.height / 2) }, timeout: 5000 });
            await expect(sidebar).toHaveAttribute('inert', '');
            await menu.click(); await sidebar.locator(`a.sidebar-nav-item[href="${home}"]`).click();
            await expect(sidebar).toHaveAttribute('inert', '');
          } else {
            await expect(sidebar).not.toHaveAttribute('inert');
            await expect(page.locator('.layout-main')).not.toHaveAttribute('inert');
          }
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
        }
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: test.info().outputPath(`${role}-mobile-rtl-light.png`) });
    } finally {
      if (!page.isClosed()) {
        await page.keyboard.press('Escape');
        await page.setViewportSize({ width: 1365, height: 900 });
        await page.locator('.preferences-selector').first().locator('button').first().click();
        await page.getByRole('button', { name: original.language === 'ar' ? 'العربية' : 'English', exact: true }).click();
        await page.locator('.preferences-selector').nth(1).locator('button').first().click();
        const label = original.language === 'en' ? ({ dark: 'Dark', light: 'Light', system: 'System' })[original.theme]
          : ({ dark: 'داكن', light: 'فاتح', system: 'النظام' })[original.theme];
        await page.locator('.preferences-option').filter({ hasText: label }).click();
      }
    }
  });
}
