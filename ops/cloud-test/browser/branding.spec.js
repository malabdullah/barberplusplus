import { test, expect } from './fixtures.js';
import path from 'node:path';

for (const width of [1440, 390]) {
  for (const theme of ['light', 'dark']) {
    for (const language of ['en', 'ar']) {
      test(`public branding: ${width}px, ${theme}, ${language}`, async ({ page }) => {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
        await page.addInitScript(({ theme, language }) => {
          localStorage.setItem('barber-theme', theme);
          localStorage.setItem('barber-language', language);
        }, { theme, language });
        for (const [name, route] of [['landing', '/'], ['login', '/login'], ['booking', '/book'], ['customer', '/customer/sign-in']]) {
          await page.goto(route);
          await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
          await expect(page.locator('html')).toHaveAttribute('dir', language === 'ar' ? 'rtl' : 'ltr');
          const logo = page.locator('.brand-logo').first();
          await expect(logo).toBeVisible();
          const logoBox = await logo.boundingBox();
          const bannerBox = await page.locator('.environment-banner').boundingBox();
          expect(logoBox.y).toBeGreaterThanOrEqual(bannerBox.y + bannerBox.height);
          expect(await logo.evaluate(el => getComputedStyle(el).direction)).toBe('ltr');
          const treatment = theme;
          const artwork = logo.locator(`.brand-logo-${treatment}`);
          await expect.poll(() => artwork.evaluate(img => img.currentSrc)).toContain(width <= 600 ? `/brand/barber-symbol-${theme}.svg` : `/brand/barber-horizontal-${theme}.svg`);
          if (width <= 600) {
            const symbol = await artwork.boundingBox();
            expect(symbol.width).toBeLessThanOrEqual(44);
            expect(symbol.height / symbol.width).toBeCloseTo(304 / 260, 1);
          }
          await expect(logo.locator(`.brand-logo-${treatment}`)).toBeVisible();
          await expect(logo.locator(`.brand-logo-${treatment === 'light' ? 'dark' : 'light'}`)).toBeHidden();
          await expect.poll(() => logo.locator(`.brand-logo-${treatment}`).evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
          if (name === 'landing' && width === 390) {
            await expect.poll(() => page.locator('.hero-cta .hero-btn-primary').evaluate(el => {
              const box = el.getBoundingClientRect();
              return box.top >= document.querySelector('.public-header').getBoundingClientRect().bottom && box.bottom <= innerHeight;
            }), { message: 'Booking is immediately reachable in the mobile homepage viewport' }).toBe(true);
          }
          if (name === 'booking') await expect(page.locator('#booking-city')).toBeVisible();
          if (name === 'booking' || name === 'customer') {
            expect(await page.locator('.customer-booking').evaluate(el => getComputedStyle(el).backgroundColor)).toBe(await page.locator('.public-site').evaluate(el => getComputedStyle(el).backgroundColor));
          }
          if (name === 'customer') {
            await expect(page.locator('#customer-auth-email')).toBeVisible();
            await expect(page.locator('.ca-social-apple')).toHaveCSS('background-color', 'rgb(0, 0, 0)');
            await expect(page.locator('.ca-social-apple')).toHaveCSS('color', 'rgb(255, 255, 255)');
            await expect(page.locator('.ca-social-google')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
            await expect(page.locator('.ca-social-google')).toBeEnabled();
            await expect(page.locator('.ca-social-apple')).toBeEnabled();
          }
          await page.screenshot({ path: path.resolve('.cloud-test', `brand-${name}-${width}-${theme}-${language}.png`) });
        }
      });
    }
  }
}

test('brand browser icons and additional authentication pages load', async ({ page, request }) => {
  for (const asset of ['/favicon.svg', '/favicon-16.png', '/favicon-32.png', '/favicon-48.png', '/apple-touch-icon.png', '/apple-touch-icon-v2.png', '/icon-192.png', '/icon-512.png', '/site.webmanifest']) {
    const response = await request.get(asset);
    expect(response.ok(), asset).toBe(true);
    expect(response.headers()['x-robots-tag']).toContain('noindex');
  }
  for (const route of ['/signup', '/forgot-password']) {
    await page.goto(route);
    await expect(page.locator('.login-logo .brand-logo')).toBeVisible();
  }
});


test('iOS installation branding loads without a Test session while the app stays private', async ({ baseURL }) => {
  expect(baseURL).toBe('https://barber-test.alabdullah-cs.workers.dev');
  const manifest = await fetch(`${baseURL}/site.webmanifest?v=2`);
  expect(manifest.status).toBe(200);
  expect(manifest.headers.get('set-cookie')).toBeNull();
  expect(manifest.headers.get('content-type')).toContain('application/manifest+json');
  const metadata = await manifest.json();
  expect(metadata.name).toBe('Barber++');
  expect(metadata.start_url).toBe('/book');
  for (const [path, size] of [['/apple-touch-icon-v2.png', 180], ['/apple-touch-icon.png', 180], ['/icon-192.png?v=2', 192], ['/icon-512.png?v=2', 512]]) {
    const response = await fetch(baseURL + path);
    expect(response.status, path).toBe(200);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('content-type')).toContain('image/png');
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(bytes.readUInt32BE(16)).toBe(size);
    expect(bytes.readUInt32BE(20)).toBe(size);
    expect(bytes[25], 'opaque RGB PNG without an alpha channel').toBe(2);
  }
  for (const path of ['/', '/book', '/runtime-config.js', '/assets/app.js', '/test-inbox?format=json', '/test-api/customer-booking']) {
    const response = await fetch(baseURL + path);
    expect(response.status, path).toBe(401);
    expect(response.headers.get('set-cookie')).toBeNull();
  }
});
