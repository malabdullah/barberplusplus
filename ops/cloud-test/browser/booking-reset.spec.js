import { test, expect, chooseBookingCity } from './fixtures.js';
import fs from 'node:fs';
const c=JSON.parse(fs.readFileSync('.cloud-test/credentials.json'));
const config=JSON.parse(fs.readFileSync('wrangler.cloud-test.jsonc'));
const copy=Object.fromEntries(['en','ar'].map(lang=>[lang,JSON.parse(fs.readFileSync(`src/i18n/locales/${lang}.json`))]));
const engine=process.env.CLOUD_TEST_BROWSER || 'chromium';
const draftKey='barber-customer-booking-draft'; const returnKey='barber-customer-booking-return'; const receiptKey='barber-customer-booking-receipt';
let chosen;let date;
test.use({browserName:engine,viewport:{width:390,height:844},isMobile:true,hasTouch:true});
test.beforeAll(async({request})=>{
 await request.get(c.appUrl,{headers:{Authorization:`Basic ${Buffer.from(`tester:${c.accessPassword}`).toString('base64')}`}});
 for(let n=1;n<8;n++){
  date=new Date(Date.now()+n*86400000).toLocaleDateString('en-CA',{timeZone:'Asia/Kuwait'});
  const response=await request.post('/test-api/customer-booking',{headers:{Origin:c.appUrl,apikey:config.vars.SUPABASE_PUBLISHABLE_KEY},data:{action:'discovery-search',mode:'time',city:'Sharq',date,rangeStart:'09:00',rangeEnd:'18:00'}});
  expect(response.status()).toBe(200);chosen=(await response.json()).items.find(item=>item.id.startsWith('b6110205'));if(chosen)break;
 }
 expect(chosen).toBeTruthy();
});
async function start(page,mode,language){
 await page.addInitScript(({language})=>{localStorage.setItem('barber-language',language);localStorage.setItem('barber-theme',language==='ar'?'dark':'light');},{language});
 await page.goto('/book');await page.locator(`[data-booking-mode=${mode}]`).click();
 if(mode==='time'){await page.locator('#finder-date').fill(date);await page.locator('.bf-range button[type=submit]').click();}
 if(mode!=='barber')await chooseBookingCity(page,'Sharq');
 if(mode==='shop')await page.locator(`[data-provider-id="${chosen.branch_id}"]`).click();
 await page.locator('#finder-search').fill(chosen.name);await page.locator(`[data-provider-id="${chosen.id}"]`).click();
 await expect(page.locator('#choose-services')).toHaveClass(/is-open/);
}
async function expectReset(page){
 await expect(page.locator('[data-booking-mode]')).toHaveCount(3);await expect(page.locator('#booking-city,#choose-services,#finder-date')).toHaveCount(0);
 expect(await page.evaluate(keys=>keys.every(key=>!localStorage.getItem(key)&&!sessionStorage.getItem(key)),[draftKey,returnKey,receiptKey])).toBe(true);
 await page.reload();await expect(page.locator('[data-booking-mode]')).toHaveCount(3);
}
for(const [mode,language] of [['time','en'],['barber','en'],['shop','ar']])test(`${engine}: clear ${mode} choices and checkout details, ${language}`,async({page})=>{
 const writes=[];page.on('request',r=>{if(r.url().includes('customer-booking')&&r.method()==='POST'&&r.postDataJSON()?.action==='book')writes.push(r.url());});
 await start(page,mode,language);await page.locator('#choose-services .cb-service:has(input:not(:disabled))').first().click();await page.locator('#booking-next').click();
 if(mode!=='time')await page.locator('#booking-date').fill(date);await page.locator('.cb-time-options label').first().click();
 await page.getByRole('button',{name:copy[language].customerBooking.accountChoice.guest,exact:true}).click();await page.locator('#customer-name').fill('Reset draft guest');await page.locator('#booking-notes').fill('Remove this draft note');
 await page.evaluate(({draftKey,returnKey,receiptKey})=>{const draft=JSON.parse(localStorage.getItem(draftKey));localStorage.setItem(returnKey,JSON.stringify({draft,returnTo:'/book',savedAt:Date.now()}));sessionStorage.setItem(returnKey,localStorage.getItem(returnKey));localStorage.setItem(receiptKey,JSON.stringify({id:'old-local-receipt',reference:'OLD',date:draft.date,time:draft.time,duration:30,price:3,services:[],savedAt:Date.now()}));},{draftKey,returnKey,receiptKey});
 await page.screenshot({path:`.cloud-test/reset-${engine}-${mode}-${language}-before.png`,fullPage:true});
 await page.getByRole('button',{name:copy[language].bookingFinder.clearSelection,exact:true}).click();await expectReset(page);
 expect(await page.evaluate(()=>localStorage.getItem('barber-language'))).toBe(language);expect(writes).toHaveLength(0);
 await page.screenshot({path:`.cloud-test/reset-${engine}-${mode}-${language}-after.png`,fullPage:true});
});
test(`${engine}: clear partial Arabic date/range before city`,async({page})=>{
 await page.addInitScript(()=>{localStorage.setItem('barber-language','ar');localStorage.setItem('barber-theme','dark');});await page.goto('/book');await page.locator('[data-booking-mode=time]').click();await page.locator('input[type=time]').first().fill('11:00');
 await page.getByRole('button',{name:copy.ar.bookingFinder.clearSelection,exact:true}).click();await expectReset(page);
});
test(`${engine}: clear keeps the customer signed in`,async({page})=>{
 const user=JSON.parse(fs.readFileSync('.cloud-test/customer-demo-credentials.json'));
 await page.goto('/customer/sign-in');await page.locator('#customer-auth-email').fill(user.email);await page.locator('#password').fill(user.password);await page.locator('.ca-panel button[type=submit]').click();
 await expect(page).toHaveURL(/\/customer\/account$/);await expect(page.locator('.ca-profile-details')).toBeVisible();const before=await page.locator('.ca-profile-details').innerText();
 await page.goto('/book');await page.locator('[data-booking-mode=barber]').click();await page.locator('#finder-search').fill(chosen.name);await page.locator(`[data-provider-id="${chosen.id}"]`).click();await expect(page.locator('#choose-services')).toHaveClass(/is-open/);
 await page.locator('[data-clear-booking]').click();await expectReset(page);await page.goto('/customer/account');await expect(page).toHaveURL(/\/customer\/account$/);await expect(page.locator('.ca-profile-details')).toHaveText(before,{useInnerText:true});
});
