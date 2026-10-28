import fs from'node:fs';import{createRequire}from'node:module';
const{chromium}=createRequire(new URL('../../../package.json',import.meta.url))('playwright');const out='/workspace/barber-cloud-candidate-state',results=[];let browser;
const check=(name,ok)=>{results.push({name,status:ok?'PASS':'FAIL'});if(!ok)throw Error('BROWSER_ASSERTION');};
try{
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-background-networking']});
 for(const[name,web,api]of[['test',55173,55321],['staging',56173,56321]]){
  const c=await browser.newContext();await c.route('https://**',r=>r.abort());let writes=0;
  await c.route(`http://127.0.0.1:${api}/rest/v1/bookings**`,async route=>{
   if(route.request().method()!=='GET'){writes++;return route.abort();}
   const response=await route.fetch(),rows=await response.json();for(const row of Array.isArray(rows)?rows:[rows])if(row.id==='50000000-0000-4000-8000-000000000001')row.date=new Date().toLocaleDateString('en-CA');await route.fulfill({response,body:JSON.stringify(rows)});
  });
  const page=await c.newPage();await page.goto(`http://127.0.0.1:${web}/login`);await page.getByLabel('Email',{exact:true}).fill('manager@barber.test');await page.getByLabel('Password',{exact:true}).fill('LocalOnly123!');await page.locator('button[type="submit"]').click();await page.waitForURL('**/dashboard');
  await page.locator('.preferences-selector').first().locator('button').first().click();await page.getByRole('button',{name:'English',exact:true}).click();
  check(name+' English cloud profile banner',(await page.locator('.environment-banner').textContent()).includes(name==='test'?'TEST — synthetic data':'STAGING — synthetic data'));
  await page.screenshot({path:out+`/${name}-english-label.png`});
  await page.goto(`http://127.0.0.1:${web}/dashboard/bookings`);check(name+' session survives navigation',!(await page.url()).includes('/login'));
  if(name==='staging'){
   await page.locator('.preferences-selector').first().locator('button').first().click();await page.getByRole('button',{name:'العربية',exact:true}).click();check('Staging Arabic banner',(await page.locator('.environment-banner').textContent()).includes('بيئة مراجعة قبل النشر — بيانات تجريبية'));
   for(const width of[360,467]){
    await page.setViewportSize({width,height:900});await page.locator('.booking-card').filter({hasText:'Synthetic Customer'}).click();const close=page.locator('.booking-close-btn');await close.click({trial:true});
    const okay=await close.evaluate(el=>{const b=el.getBoundingClientRect(),banner=document.querySelector('.environment-banner').getBoundingClientRect();return b.top>=banner.bottom-1&&el.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2));});check('Arabic Staging close hit '+width,okay);await page.screenshot({path:out+`/staging-arabic-booking-${width}.png`});await close.click();check('Arabic Staging panel closes '+width,await page.locator('.booking-sidebar-overlay').count()===0);
   }
  }
  check(name+' no booking writes',writes===0);await c.close();
 }
}catch(e){results.push({name:'browser smoke completed',status:'FAIL',category:e.name});process.exitCode=1;}
finally{await browser?.close();fs.writeFileSync(out+'/profile-browser-result.json',JSON.stringify({result:results.every(r=>r.status==='PASS')?'PASS':'FAIL',evidence:'Actual local browser/services with test-only read date projection; no owner/tunnel proof',checks:results},null,2));console.log(JSON.stringify(results));}
