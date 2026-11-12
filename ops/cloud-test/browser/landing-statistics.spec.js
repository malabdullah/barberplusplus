import { test, expect } from './fixtures.js';
for (const language of ['en', 'ar']) {
 test(`customer-first landing and immediate theme toggle in ${language}`, async ({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.addInitScript(language=>{localStorage.setItem('barber-language',language);localStorage.setItem('barber-theme','light');},language);
  await page.goto('/');
  await expect(page.locator('[data-landing-booking]')).toHaveCount(3);
  await expect(page.locator('.lp-preview-label')).toHaveText(language==='ar'?'معاينة توضيحية':'Demo preview');
  await expect(page.locator('.hero-stat-value')).toHaveCount(0);
  const theme=page.locator('.public-header .preferences-selector').nth(1).locator('button');
  await theme.click();await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await expect(page.locator('.preferences-dropdown')).toHaveCount(0);
  await page.reload();await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await theme.press('Enter');await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 });
}
test('landing shortcuts enter the corresponding booking journey',async({page})=>{
 for(const mode of ['time','barber','shop']){
  await page.goto('/');await page.locator(`[data-landing-booking=${mode}]`).click();
  await expect(page).toHaveURL(/\/book$/);
  if(mode==='time'){await expect(page.locator('#finder-date')).toBeVisible();await expect(page.locator('#booking-city')).toHaveCount(0);}
  if(mode==='barber')await expect(page.locator('#finder-search')).toBeVisible();
  if(mode==='shop')await expect(page.locator('#booking-city')).toBeVisible();
 }
});
