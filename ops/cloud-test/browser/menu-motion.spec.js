import { test, expect } from './fixtures.js';

for (const language of ['en', 'ar']) {
  for (const reduced of [false, true]) {
    test(`mobile menu opens and closes smoothly: ${language}, reduced motion ${reduced}`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
      await page.addInitScript(language => localStorage.setItem('barber-language', language), language);
      await page.goto('/');
      const open = page.getByRole('button', { name: language === 'ar' ? 'فتح القائمة' : 'Open menu', exact: true });
      const close = page.getByRole('button', { name: language === 'ar' ? 'إغلاق القائمة' : 'Close menu', exact: true });
      const panel = page.locator('.public-mobile-menu');
      await panel.evaluate(el => {
        el.dataset.motionRuns = '0';
        el.addEventListener('transitionrun', event => {
          if (event.target === el && event.propertyName === 'grid-template-rows') el.dataset.motionRuns = String(Number(el.dataset.motionRuns) + 1);
        });
      });
      const closedHeight = await panel.evaluate(el => el.getBoundingClientRect().height);
      expect(closedHeight).toBe(0);
      await open.click();
      await expect(panel).not.toHaveAttribute('inert');
      const duration = await panel.evaluate(el => getComputedStyle(el).transitionDuration);
      expect(duration).toBe(reduced ? '0s' : '0.18s, 0.18s, 0s');
      // Inspect the actual native transitions rather than sleeping for a timer.
      await panel.evaluate(async el => { await Promise.all(el.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {}))); });
      const openHeight = await panel.evaluate(el => el.getBoundingClientRect().height);
      expect(openHeight).toBeGreaterThan(250);
      await expect(panel).toHaveAttribute('data-motion-runs', reduced ? '0' : '1');
      await expect(panel.getByRole('link')).toHaveCount(4);
      await close.click();
      await expect(panel).toHaveAttribute('inert', '');
      await expect(panel).toHaveAttribute('aria-hidden', 'true');
      await panel.evaluate(async el => { await Promise.all(el.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {}))); });
      expect(await panel.evaluate(el => el.getBoundingClientRect().height)).toBe(0);
      await expect(panel).toBeHidden();
      await expect(panel).toHaveAttribute('data-motion-runs', reduced ? '0' : '2');
      // A fast reversal should settle correctly without queued close timers.
      await open.click();
      await close.click();
      await open.click();
      await page.keyboard.press('Escape');
      await expect(open).toBeFocused();
      await expect(panel).toBeHidden();
    });
  }
}

for (const reduced of [false, true]) {
  test(`desktop dropdown closes smoothly and restores focus: reduced motion ${reduced}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
    await page.goto('/');
    const button = page.getByRole('button', { name: 'Shops', exact: true });
    const panel = page.locator('#public-shops-links');
    await button.click();
    await expect(panel).toBeVisible();
    expect(await panel.evaluate(el => getComputedStyle(el).transitionDuration)).toBe(reduced ? '0s' : '0.16s, 0.16s, 0s');
    await panel.getByRole('link', { name: 'Team sign in', exact: true }).focus();
    await page.keyboard.press('Escape');
    await expect(button).toBeFocused();
    await expect(panel).toHaveAttribute('inert', '');
    await expect(panel).toBeHidden();
    await button.click();
    await page.locator('#hero-title').click();
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await expect(panel).toBeHidden();
  });
}
