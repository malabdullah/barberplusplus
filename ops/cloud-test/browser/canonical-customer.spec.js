import { test, expect } from './fixtures.js';
import fs from 'node:fs';
const path=new URL('../../../.cloud-test/canonical-test-account.json',import.meta.url);
const account=fs.existsSync(path)?JSON.parse(fs.readFileSync(path)):{};
const engine=process.env.CLOUD_TEST_BROWSER||'chromium';
test.use({browserName:engine,viewport:{width:390,height:844},...(account.storageState?{storageState:account.storageState}:{})});
test.skip(!account.storageState,'Requires the confirmed synthetic canonical-customer fixture.');
for(const language of ['en','ar'])for(const theme of ['light','dark']){
 test(`canonical customer profile survives save/reload and rebooking: ${engine} ${language} ${theme}`,async({page})=>{
  await page.addInitScript(({language,theme})=>{localStorage.setItem('barber-language',language);localStorage.setItem('barber-theme',theme);},{language,theme});
  await page.goto('/customer/account');
  const main=page.locator('.ca-account');
  const edit=language==='en'?'Edit details':'تعديل البيانات';const save=language==='en'?'Save changes':'حفظ التغييرات';
  const name=`Canonical Browser ${engine} ${language} ${theme}`;
  await main.getByRole('button',{name:edit,exact:true}).click();await page.locator('#account-name').fill(name);
  const response=page.waitForResponse(r=>r.url().includes('customer-auth')&&r.request().postDataJSON()?.action==='update-profile');
  await main.getByRole('button',{name:save,exact:true}).click();
  const result=await response;expect(result.status()).toBe(200);const profile=(await result.json()).profile;
  expect(profile.id).toBe(account.userId);expect(profile.customerId).toBe(account.customerId);
  await expect(page.locator('.ca-profile-details')).toContainText(name);
  await page.reload();await expect(page.locator('.ca-profile-details')).toContainText(name);
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth',await page.locator('body').evaluate(e=>e.clientWidth));
  await main.getByRole('button',{name:language==='en'?'Past appointments':'المواعيد السابقة',exact:true}).click();
  await expect(main.locator('.ca-booking-row').first()).toBeVisible();
  await main.getByRole('button',{name:language==='en'?'Book again':'احجز مرة أخرى',exact:true}).first().click();
  await expect(page).toHaveURL(/\/book$/);await expect(page.locator('#choose-services')).toHaveClass(/is-open/);
  await expect(page.locator('#choose-services input:checked')).toHaveCount(0);
  await page.goto('/customer/account');await main.getByRole('button',{name:edit,exact:true}).click();
  await page.locator('#account-name').fill('Canonical Hosted Customer');await main.getByRole('button',{name:save,exact:true}).click();
  await expect(page.locator('.ca-profile-details')).toContainText('Canonical Hosted Customer');
  await page.locator('.ca-profile-panel').screenshot({path:`.cloud-test/canonical-${engine}-${language}-${theme}.png`});
 });
}
