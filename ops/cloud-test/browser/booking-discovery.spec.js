import { test, expect, chooseBookingCity } from './fixtures.js';
import fs from 'node:fs';
const c=JSON.parse(fs.readFileSync('.cloud-test/credentials.json'));
const key=JSON.parse(fs.readFileSync('wrangler.cloud-test.jsonc')).vars.SUPABASE_PUBLISHABLE_KEY;
const engine=process.env.CLOUD_TEST_BROWSER || 'chromium';
let chosen;let date;
test.use({browserName:engine,viewport:{width:390,height:844},isMobile:true,hasTouch:true});
async function call(request,action,data={}) {
 const r=await request.post('/test-api/customer-booking',{headers:{Origin:c.appUrl,apikey:key},data:{action,...data}});expect(r.status()).toBe(200);return r.json();
}
test.beforeAll(async({request})=>{
 await request.get(c.appUrl,{headers:{Authorization:`Basic ${Buffer.from(`tester:${c.accessPassword}`).toString('base64')}`}});
 for(let n=1;n<8;n++){
  date=new Date(Date.now()+n*86400000).toLocaleDateString('en-CA',{timeZone:'Asia/Kuwait'});
  const result=await call(request,'discovery-search',{mode:'time',city:'Sharq',date,rangeStart:'09:00',rangeEnd:'18:00'});
  chosen=result.items.find(item=>item.id.startsWith('b6110205'));
  if(chosen)break;
 }
 expect(chosen).toBeTruthy();
});
async function checkOverflow(page){expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);}
for(const language of ['en','ar'])for(const theme of ['light','dark'])for(const mode of ['time','barber','shop']){
 test(`${mode} booking discovery: ${engine} ${language} ${theme}`,async({page})=>{
  const errors=[];const actions=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('customer-booking')&&r.method()==='POST')actions.push(r.postDataJSON()?.action);});
  await page.addInitScript(({language,theme})=>{localStorage.setItem('barber-language',language);localStorage.setItem('barber-theme',theme);},{language,theme});
  await page.goto('/book',{waitUntil:'domcontentloaded'});await expect(page.locator('[data-booking-mode]')).toHaveCount(3);await checkOverflow(page);
  if(mode==='time'&&language==='en'&&theme==='dark')await page.screenshot({path:`.cloud-test/discovery-${engine}-methods.png`,fullPage:true});
  await page.locator(`[data-booking-mode="${mode}"]`).click();
  if(mode==='time'){
   await expect(page.locator('#booking-city')).toHaveCount(0);
   await page.locator('#finder-date').fill(date);await page.locator('input[type=time]').nth(0).fill('09:00');await page.locator('input[type=time]').nth(1).fill('18:00');
   await page.screenshot({path:`.cloud-test/discovery-${engine}-${language}-${theme}-range.png`,fullPage:true});
   await page.locator('.bf-range button[type=submit]').click();
  }
  if(mode!=='barber')await chooseBookingCity(page,'Sharq');
  if(mode==='shop')await page.locator(`[data-provider-id="${chosen.branch_id}"]`).click();
  await page.locator('#finder-search').fill(chosen.name);
  await page.locator(`[data-provider-id="${chosen.id}"]`).click();
  await expect(page.locator('#choose-services')).toHaveClass(/is-open/);
  await page.locator('#choose-services .cb-service:has(input[type=checkbox]:not(:disabled))').first().click();
  await page.locator('#booking-next').click();
  if(mode!=='time')await page.locator('#booking-date').fill(date);
  await expect(page.locator('.cb-time-options label').first()).toBeVisible();
  await page.locator('.cb-time-options label').first().click();
  await expect(page.locator('#choose-details')).toHaveClass(/is-open/);
  const before=await page.evaluate(()=>JSON.parse(localStorage.getItem('barber-customer-booking-draft')));
  expect(before.barberId).toBe(chosen.id);expect(before.branchId).toBe(chosen.branch_id);expect(before.bookingMode).toBe(mode);
  if(mode==='time'){expect(before.time>='09:00'&&before.time<='18:00').toBe(true);expect(before.rangeStart).toBe('09:00');}
  await page.reload({waitUntil:'domcontentloaded'});await expect(page.locator('#choose-details')).toHaveClass(/is-open/);
  const after=await page.evaluate(()=>JSON.parse(localStorage.getItem('barber-customer-booking-draft')));
  for(const field of ['city','branchId','barberId','date','time','bookingMode','rangeStart','rangeEnd'])expect(after[field]).toEqual(before[field]);expect(after.serviceIds).toEqual(before.serviceIds);
  await checkOverflow(page);expect(actions).not.toContain('catalog');expect(errors).toEqual([]);
  await page.screenshot({path:`.cloud-test/discovery-${engine}-${mode}-${language}-${theme}-checkout.png`,fullPage:true});
  await page.locator('#choose-city .cb-section-heading button').click();
  await expect(page.locator('#booking-city')).toBeInViewport();
  if(mode==='time'){const edited=await page.evaluate(()=>JSON.parse(localStorage.getItem('barber-customer-booking-draft')));expect(edited.rangeStart).toBe('09:00');expect(edited.date).toBe(date);}
 });
}
test('barber search pages contain no duplicates, reset after a filter change, and preserve privacy',async({request,page})=>{
 const first=await call(request,'discovery-search',{mode:'barber'});expect(first.items.length).toBe(20);expect(first.nextCursor).toBeTruthy();
 const second=await call(request,'discovery-search',{mode:'barber',cursor:first.nextCursor});expect(second.items.length).toBeGreaterThan(0);
 expect(second.items.every(item=>!first.items.some(old=>old.id===item.id))).toBe(true);
 for(const item of [...first.items,...second.items]){for(const field of ['email','phone','availability','time_offs','vacations','user_id'])expect(item).not.toHaveProperty(field);}
 await page.goto('/book');await page.locator('[data-booking-mode=barber]').click();await expect(page.locator('.bf-pagination')).toBeVisible();
 await page.locator('.bf-pagination button').last().click();await expect(page.locator('.bf-pagination')).toContainText('2');
 await page.locator('#finder-search').fill(chosen.name);await expect(page.locator(`[data-provider-id="${chosen.id}"]`)).toBeVisible();await expect(page.locator('.bf-pagination')).toHaveCount(0);
});
test('personal sign-in returns to the selected time-first appointment',async({page})=>{
 const user=JSON.parse(fs.readFileSync('.cloud-test/customer-demo-credentials.json'));
 await page.goto('/book');await page.locator('[data-booking-mode=time]').click();await page.locator('#finder-date').fill(date);
 await page.locator('.bf-range button[type=submit]').click();await chooseBookingCity(page,'Sharq');await page.locator('#finder-search').fill(chosen.name);await page.locator(`[data-provider-id="${chosen.id}"]`).click();
 await page.locator('#choose-services .cb-service:has(input[type=checkbox]:not(:disabled))').first().click();await page.locator('#booking-next').click();await page.locator('.cb-time-options label').first().click();
 const before=await page.evaluate(()=>JSON.parse(localStorage.getItem('barber-customer-booking-draft')));
 await page.locator('#choose-details .cb-account-choice a[href^="/customer/sign-in"]').click();
 await page.locator('#customer-auth-email').fill(user.email);await page.locator('#password').fill(user.password);await page.locator('.ca-panel button[type=submit]').click();
 await expect(page).toHaveURL(/\/book$/);await expect(page.locator('.cb-verified-details')).toBeVisible();
 const after=await page.evaluate(()=>JSON.parse(localStorage.getItem('barber-customer-booking-draft')));for(const field of ['city','branchId','barberId','date','time','rangeStart','rangeEnd','bookingMode'])expect(after[field]).toBe(before[field]);expect(after.serviceIds).toEqual(before.serviceIds);
});
