import {test,expect} from './fixtures.js';
import fs from 'node:fs';
import path from 'node:path';
async function chooseTheme(page, theme) {
  if (await page.locator('html').getAttribute('data-theme') !== theme) await page.locator('.preferences-selector').nth(1).locator('button').first().click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
}
const state = JSON.parse(fs.readFileSync(new URL('../../../.cloud-test/credentials.json',import.meta.url)));
const screenshot = name => path.resolve('.cloud-test',`${name}.png`);

for (const [role, home] of [['admin','/admin'],['manager','/dashboard'],['agent','/agent'],['barber','/barber']]) {
  test(`${role}: hosted login, workspace, mobile Arabic and theme`, async ({page}) => {
    await page.goto('/login');
    await page.getByLabel('Email',{exact:true}).fill(`${role}@barber.test`);
    await page.getByLabel('Password',{exact:true}).fill(state.staffPassword);
    const settingsLoaded = page.waitForResponse(response => response.url().includes('/rest/v1/user_settings?') && response.status() === 200);
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(new RegExp(home+'(?:/|$)'));
    await settingsLoaded;
    await page.locator('.preferences-selector').first().locator('button').first().click();
    await page.getByRole('button',{name:'English',exact:true}).click();
    await chooseTheme(page, 'dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
    await expect(page.locator('.environment-banner')).toContainText(/TEST/);
    const brand = page.locator('.sidebar-logo .brand-logo');
    await expect(brand).toBeVisible();
    await expect(brand.locator('.brand-logo-dark')).toBeVisible();
    await page.screenshot({path:screenshot(`brand-${role}-desktop-dark`)});
    await chooseTheme(page, 'light');
    await expect(brand.locator('.brand-logo-light')).toBeVisible();
    await page.screenshot({path:screenshot(`brand-${role}-desktop-light`)});
    if (role === 'manager') {
      await page.goto('/dashboard/branches');
      await expect(page.locator('.branch-card-name',{hasText:'Synthetic Branch'})).toBeVisible();
      await expect(page.locator('.branch-card-name',{hasText:'Other Tenant Branch'})).toHaveCount(0);
    }
    if (role === 'admin') {
      await page.goto('/admin/users/passwords');
      await expect(page.locator('#reset-user option')).not.toHaveCount(1);
      await expect(page.locator('[role="alert"]')).toHaveCount(0);
    }
    await page.setViewportSize({width:390,height:844});
    await page.locator('.preferences-selector').first().locator('button').first().click();
    await page.getByRole('button',{name:'العربية',exact:true}).click();
    await expect(page.locator('html')).toHaveAttribute('dir','rtl');
    await chooseTheme(page, 'light');
    await expect(page.locator('html')).toHaveAttribute('data-theme','light');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth+1)).toBe(true);
    await page.screenshot({path:screenshot(`${role}-mobile-arabic`)});
    await page.locator('.topbar-menu-btn').click();
    await expect(page.locator('aside.sidebar')).toHaveAttribute('role','dialog');
    await expect(brand.locator('.brand-logo-light')).toBeVisible();
    expect(await brand.evaluate(el=>getComputedStyle(el).direction)).toBe('ltr');
    await expect.poll(async()=>{
      const box=await brand.boundingBox();
      return box && box.x>=0 && box.x+box.width<=390;
    }).toBe(true);
    await expect.poll(()=>brand.evaluate(el=>{
      const box=el.getBoundingClientRect();
      return el.contains(document.elementFromPoint(box.x+box.width/2,box.y+box.height/2));
    })).toBe(true);
    await page.screenshot({path:screenshot(`brand-${role}-mobile-light-arabic`)});
    await page.keyboard.press('Escape');
    await page.locator('.preferences-selector').first().locator('button').first().click();
    await page.getByRole('button',{name:'English',exact:true}).click();
    await chooseTheme(page, 'dark');
    await page.locator('.topbar-menu-btn').click();
    await expect(brand.locator('.brand-logo-dark')).toBeVisible();
    await expect.poll(async()=>{
      const box=await brand.boundingBox();
      return box && box.x>=0 && box.x+box.width<=390;
    }).toBe(true);
    await expect.poll(()=>brand.evaluate(el=>{
      const box=el.getBoundingClientRect();
      return el.contains(document.elementFromPoint(box.x+box.width/2,box.y+box.height/2));
    })).toBe(true);
    await page.screenshot({path:screenshot(`brand-${role}-mobile-dark`)});
    await page.keyboard.press('Escape');
    await page.getByRole('link',{name:'Visit website',exact:true}).click();
    await expect(page).toHaveURL(/workers\.dev\/$/);
    await expect(page.locator('#hero-title')).toBeVisible();
    await page.getByRole('button',{name:'Open menu',exact:true}).click();
    await page.locator('#public-mobile-links').getByRole('link',{name:'Open workspace',exact:true}).click();
    await expect(page).toHaveURL(new RegExp(home+'(?:/|$)'));
  });
}

test('guest completes a real hosted booking',async ({page})=>{
  await page.goto('/book');
  await page.locator('#booking-city').selectOption('Kuwait City');
  await page.locator('input[name="branch"][value="10000000-0000-4000-8000-000000000011"]').check();
  await page.locator('input[name="barber"]').first().check();
  await page.locator('#choose-services input[type="checkbox"]').first().check();
  await page.locator('#booking-next').click();
  await page.locator('#booking-date').fill(new Date(Date.now()+86400000).toISOString().slice(0,10));
  await page.locator('input[name="time"]').first().check();
  await page.locator('#customer-name').fill('Cloud Test Guest');
  await page.locator('#customer-phone').fill('50000991');
  await page.locator('#booking-notes').fill('Synthetic cloud readiness check');
  await page.locator('#booking-next').click();
  await expect(page.locator('.cb-success')).toBeVisible();
  await page.screenshot({path:screenshot('guest-booking-confirmed'),fullPage:true});
});

test('customer email signup confirms through the private test inbox',async ({page,request})=>{
  const email = `customer-${Date.now()}@barber.test`;
  await page.goto('/customer/sign-up');
  await page.locator('#customer-auth-name').fill('Cloud Test Customer');
  await page.locator('#customer-auth-email').fill(email);
  await page.locator('#password').fill(state.staffPassword);
  await page.locator('#confirmPassword').fill(state.staffPassword);
  await page.locator('button[type="submit"]').click();
  await expect(page.locator('.ca-main [role="status"]')).toBeVisible();
  const inbox = await request.get('/test-inbox?format=json');
  expect(inbox.ok()).toBe(true);
  const messages = await inbox.json();
  const message = messages.find(mail=>mail.recipient===email && (mail.link || mail.payload?.email_data?.email_action_type==='signup'));
  expect(message).toBeTruthy();
  const confirmation = message.link || (()=>{
    const data=message.payload.email_data;
    const url=new URL(`https://${state.projectRef}.supabase.co/auth/v1/verify`);
    url.searchParams.set('token',data.token_hash);url.searchParams.set('type',data.email_action_type);
    url.searchParams.set('redirect_to',data.redirect_to);return url.href;
  })();
  await page.goto(confirmation);
  await expect(page.locator('#customer-auth-title')).toHaveText('Email verified');
  await page.locator('.ca-main').getByRole('link', { name: 'My account', exact: true }).click();
  await expect(page).toHaveURL(/\/customer\/account$/);
  await expect(page.locator('body')).toContainText('Cloud Test Customer');
  await page.screenshot({path:screenshot('customer-account'),fullPage:true});
});

test('private inbox and mobile landing are usable',async ({page})=>{
  await page.goto('/test-inbox');
  await expect(page.getByRole('heading',{level:1})).toContainText('Test email inbox');
  await page.goto('/');
  await expect(page).toHaveTitle(/Barber\+\+/);
  await expect(page.locator('.environment-banner')).toBeVisible();
  await page.screenshot({path:screenshot('test-website'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
});
