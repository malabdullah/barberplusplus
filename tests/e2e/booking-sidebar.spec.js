import {expect,test} from '@playwright/test';

test.afterEach(async({context})=>{await context.unrouteAll({behavior:'wait'});});
test('synthetic manager booking close is unobscured with Test banner',async({page,context})=>{
 test.setTimeout(120000);
 const base=new URL(test.info().project.use.baseURL||'http://127.0.0.1:4173');
 expect(['localhost','127.0.0.1','::1']).toContain(base.hostname);
 const api=new URL(process.env.BARBER_QA_API||'http://127.0.0.1:54321');
 expect(['localhost','127.0.0.1']).toContain(api.hostname);
 const runtime={environment:'staging',appUrl:'https://barber-test-ui.invalid',supabaseUrl:'https://barber-test-api.invalid',supabasePublishableKey:process.env.VITE_SUPABASE_PUBLISHABLE_KEY,release:'booking-sidebar-local-regression'};
 expect(runtime.supabasePublishableKey).toBeTruthy();
 let bookingWrites=0;
 await context.route('https://barber-test-api.invalid/**',async route=>{
  const u=new URL(route.request().url());expect(u.origin).toBe(runtime.supabaseUrl);
  if(u.pathname.startsWith('/rest/v1/bookings')&&route.request().method()!=='GET')bookingWrites++;
  const response=await route.fetch({url:new URL(u.pathname+u.search,api).href,headers:{...route.request().headers(),host:api.host},maxRedirects:0});
  // Test-only date projection puts the existing 2030 fixture in the current
  // calendar week. It never writes a row or substitutes backend authorization.
  let body=await response.body();
  if(u.pathname==='/rest/v1/bookings'&&response.ok()){
   const rows=JSON.parse(body.toString());const date=new Date().toLocaleDateString('en-CA');
   for(const row of Array.isArray(rows)?rows:[rows])if(row.id==='50000000-0000-4000-8000-000000000001')row.date=date;
   body=Buffer.from(JSON.stringify(rows));
  }
  await route.fulfill({response,body,headers:{...response.headers(),'access-control-allow-origin':base.origin}});
 });
 await context.routeWebSocket('wss://barber-test-api.invalid/**',socket=>socket.close());
 // The served local asset runs after addInitScript; keep this fixture authoritative.
 await context.route(new URL('/runtime-config.js', base).href, route => route.fulfill({
   contentType: 'application/javascript', body: 'window.__BARBER_CONFIG__ = ' + JSON.stringify(runtime) + ';',
 }));
 await page.addInitScript(value=>{window.__BARBER_CONFIG__=Object.freeze(value);},runtime);
 await page.goto('/login');await page.getByLabel('Email',{exact:true}).fill('manager@barber.test');await page.getByLabel('Password',{exact:true}).fill('LocalOnly123!');await page.locator('button[type="submit"]').click();await expect(page).toHaveURL(/\/dashboard(?:\/|$)/);
 await page.goto('/dashboard/bookings');await expect(page.locator('.booking-card').filter({hasText:'Synthetic Customer'})).toHaveCount(1);
 for(const language of ['en','ar']){
  await page.locator('.preferences-selector').first().locator('button').first().click();await page.getByRole('button',{name:language==='ar'?'العربية':'English',exact:true}).click();
  for(const theme of ['dark','light']){
   await page.locator('.preferences-selector').nth(1).locator('button').first().click();const label=language==='en'?(theme==='dark'?'Dark':'Light'):(theme==='dark'?'داكن':'فاتح');await page.locator('.preferences-option').filter({hasText:label}).click();
   for(const width of [360,467,1365]){
    await page.setViewportSize({width,height:900});await page.locator('.booking-card').filter({hasText:'Synthetic Customer'}).click();
    const close=page.locator('.booking-close-btn');await expect(close).toBeVisible();await close.click({trial:true});
    const geometry=await close.evaluate(el=>{const b=el.getBoundingClientRect(),banner=document.querySelector('.environment-banner').getBoundingClientRect();const hit=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);const traps=[];for(let p=document.querySelector('.booking-sidebar-overlay').parentElement;p;p=p.parentElement){const s=getComputedStyle(p);if(s.transform!=='none'||s.filter!=='none'||s.perspective!=='none'||/paint|layout|strict|content/.test(s.contain))traps.push(p.tagName);}return{aboveBanner:b.top>=banner.bottom-1,inViewport:b.bottom<=innerHeight&&b.left>=0&&b.right<=innerWidth,hit:el.contains(hit),traps};});
    expect(geometry,`${language}/${theme}/${width}`).toEqual({aboveBanner:true,inViewport:true,hit:true,traps:[]});
    await page.screenshot({path:test.info().outputPath(`booking-${language}-${theme}-${width}.png`)});
    await close.click();await expect(page.locator('.booking-sidebar-overlay')).toHaveCount(0);
   }
  }
 }
 expect(bookingWrites).toBe(0);
});
