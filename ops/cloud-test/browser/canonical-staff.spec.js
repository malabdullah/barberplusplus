import { test, expect } from './fixtures.js';
import fs from 'node:fs';
const path=new URL('../../../.cloud-test/canonical-agent-session.json',import.meta.url);
const state=fs.existsSync(path)?JSON.parse(fs.readFileSync(path)):null;
const engine=process.env.CLOUD_TEST_BROWSER||'chromium';
test.use({browserName:engine,viewport:{width:1280,height:900},...(state?{storageState:state}:{})});
test.skip(!state,'Requires the ordinary synthetic Test agent session.');
for(const language of ['en','ar'])for(const theme of ['light','dark']){
 test(`staff edits phone-optional shared profile and separate notes: ${language} ${theme}`,async({page})=>{
  await page.addInitScript(({language,theme})=>{localStorage.setItem('barber-language',language);localStorage.setItem('barber-theme',theme);},{language,theme});
  await page.goto('/agent/customers');
  async function open(){await page.locator('.agent-search-input').fill('Canonical Hosted Customer');await page.locator('.agent-search-input').press('Enter');await page.locator('.agent-customer-card').filter({hasText:'Canonical Hosted Customer'}).click();await page.locator('.agent-customer-header-actions button').first().click();}
  await open();const modal=page.locator('.modal-container');
  await expect(modal.locator('[name="phone"]')).toHaveValue('');
  const note=`Canonical staff verification ${language} ${theme}`;
  await modal.locator('[name="notes"]').fill(note);await modal.locator('[name="tags"]').fill('canonical');
  const response=page.waitForResponse(r=>r.url().includes('/rpc/save_customer_profile'));
  await modal.locator('button[type="submit"]').click();expect((await response).status()).toBe(200);await expect(modal).not.toBeVisible();
  await page.reload();await open();await expect(modal.locator('[name="notes"]')).toHaveValue(note);await expect(modal.locator('[name="tags"]')).toHaveValue('canonical');
  await modal.screenshot({path:`.cloud-test/canonical-staff-${language}-${theme}.png`});
  await modal.locator('[name="notes"]').fill('');await modal.locator('[name="tags"]').fill('');await modal.locator('button[type="submit"]').click();await expect(modal).not.toBeVisible();
 });
}
