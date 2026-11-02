import { test, expect } from './fixtures.js';
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
const path=new URL('../../../.cloud-test/canonical-agent-session.json',import.meta.url);
const state=fs.existsSync(path)?JSON.parse(fs.readFileSync(path)):null;
const fixture=state?JSON.parse(fs.readFileSync(new URL('../../../.cloud-test/canonical-test-account.json',import.meta.url))):{};
const engine=process.env.CLOUD_TEST_BROWSER||'chromium';
test.use({browserName:engine,viewport:{width:1280,height:900},...(state?{storageState:state}:{})});
test.skip(!state,'Requires the ordinary synthetic Test agent session.');
const session=state?JSON.parse(state.origins[0].localStorage[0].value):null;
const keys=state?JSON.parse(fs.readFileSync(new URL('../../../.cloud-test/api-keys.json',import.meta.url))):[];
const prefClient=state?createClient('https://qvkucvcjmojjbphlzlks.supabase.co',keys.find(k=>k.name==='anon').api_key,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:`Bearer ${session.access_token}`}}}):null;
for(const language of ['en','ar'])for(const theme of ['light','dark']){
 test(`staff edits phone-optional shared profile and separate notes: ${language} ${theme}`,async({page})=>{
  await page.addInitScript(({language,theme})=>{localStorage.setItem('barber-language',language);localStorage.setItem('barber-theme',theme);},{language,theme});
  expect(session.user.app_metadata.role).toBe('agent');
  const settings=await prefClient.from('user_settings').upsert({user_id:session.user.id,language,theme},{onConflict:'user_id'}).select('language,theme').single();
  expect(settings.error).toBeNull();expect(settings.data).toEqual({language,theme});
  await page.goto('/agent/customers');
  await expect(page.locator('.agent-search-input')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang',language);
  await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
  async function open(){await page.locator('.agent-search-input').fill('Canonical Hosted Customer');await page.locator('.agent-search-input').press('Enter');await page.locator('.agent-customer-card').filter({hasText:'Canonical Hosted Customer'}).click();await page.locator('.agent-customer-header-actions button').first().click();}
  await open();const modal=page.locator('.modal-container');
  await expect(modal.locator('[name="phone"]')).toHaveValue('');
  const note=`Canonical staff verification ${language} ${theme}`;
  await modal.locator('[name="notes"]').fill(note);await modal.locator('[name="tags"]').fill('canonical');
  const response=page.waitForResponse(r=>r.url().includes('/rpc/save_customer_profile'));
  await modal.locator('button[type="submit"]').click();expect((await response).status()).toBe(200);await expect(modal).not.toBeVisible();
  await page.reload();await open();await expect(page.locator('html')).toHaveAttribute('lang',language);await expect(page.locator('html')).toHaveAttribute('data-theme',theme);await expect(modal.locator('[name="notes"]')).toHaveValue(note);await expect(modal.locator('[name="tags"]')).toHaveValue('canonical');
  await modal.screenshot({path:`.cloud-test/canonical-staff-${language}-${theme}.png`});
  await modal.locator('[name="notes"]').fill('');await modal.locator('[name="tags"]').fill('');await modal.locator('button[type="submit"]').click();await expect(modal).not.toBeVisible();
  await page.locator('.agent-customer-header-actions a').click();
  await expect(page).toHaveURL(/\/agent\/bookings\/new$/);
  await page.locator('.topbar-branch-btn').click();
  await page.locator('.topbar-branch-dropdown .topbar-dropdown-item').first().click();
  await expect(page.locator('[name="customerName"]')).toHaveValue('Canonical Hosted Customer');
  await expect(page.locator('[name="customerPhone"]')).toHaveValue('');
  await expect(page.locator('[name="customerName"]')).toHaveAttribute('readonly','');
  await expect(page.locator('[name="customerPhone"]')).toHaveAttribute('readonly','');
  const selected=await page.evaluate(()=>history.state.usr.customer);
  expect(selected.id).toBe(fixture.customerId);
 });
}
