import { test, expect } from './fixtures.js';
import fs from 'node:fs';
const accountPath=new URL('../../../.cloud-test/rebook-test-account.json',import.meta.url);
const account=fs.existsSync(accountPath)?JSON.parse(fs.readFileSync(accountPath)):{};
const engine=process.env.CLOUD_TEST_BROWSER||'chromium';
test.use({browserName:engine,viewport:{width:390,height:844},...(account.storageState?{storageState:account.storageState}:{})});
test.skip(!account.storageState,'Requires a verified, isolated synthetic customer session.');
for(const language of ['en','ar'])for(const theme of ['light','dark']){
 test(`customer cannot save another account phone: ${engine} ${language} ${theme}`,async({page})=>{
  await page.addInitScript(({language,theme})=>{localStorage.setItem('barber-language',language);localStorage.setItem('barber-theme',theme);},{language,theme});
  await page.goto('/customer/account');
  await page.locator('.ca-account').getByRole('button',{name:language==='en'?'Edit details':'تعديل البيانات',exact:true}).click();
  await page.locator('#account-phone').fill('59999081');
  const response=page.waitForResponse(r=>r.url().includes('customer-auth')&&r.request().postDataJSON()?.action==='update-profile');
  await page.locator('.ca-account').getByRole('button',{name:language==='en'?'Save changes':'حفظ التغييرات',exact:true}).click();
  const rejected=await response;expect(rejected.status()).toBe(409);expect((await rejected.json()).error).toBe('PHONE_IN_USE');
  const alert=page.locator('#profile-error');await expect(alert).toHaveText(language==='en'?'This phone number is already in use. Use a different number.':'رقم الهاتف هذا مستخدم بالفعل. استخدم رقماً آخر.');
  await expect(alert).toBeFocused();await expect(page.locator('#account-phone')).toHaveValue('59999081');
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth',await page.locator('body').evaluate(e=>e.clientWidth));
  await page.locator('.ca-profile-panel').screenshot({path:`.cloud-test/global-phone-${engine}-${language}-${theme}.png`});
  await page.locator('.ca-account').getByRole('button',{name:language==='en'?'Cancel':'إلغاء',exact:true}).click();
  await expect(page.locator('.ca-profile-details')).not.toContainText('59999081');
 });
}
