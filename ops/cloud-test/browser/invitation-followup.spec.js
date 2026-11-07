import fs from 'node:fs';
import { test, expect } from './fixtures.js';
const c=JSON.parse(fs.readFileSync('.cloud-test/credentials.json'));
const m=JSON.parse(fs.readFileSync('.cloud-test/manager-review-fixture.json'));
const b=JSON.parse(fs.readFileSync('.cloud-test/invitation-browser-fixture.json'));
async function login(page,email){await page.goto('/login');await page.locator('#email').fill(email);await page.locator('#password').fill(c.staffPassword);await page.locator('button[type="submit"]').click();}
test('invited barber submits hours; manager reviews separately',async({page,context})=>{
 await login(page,b.email);await expect(page).toHaveURL(/\/barber$/);await page.goto('/barber/availability');
 await expect(page.locator('.schedule-row')).toHaveCount(7);const day=page.locator('.schedule-row').first();await day.locator('.schedule-toggle').click();
 await day.locator('select').nth(0).selectOption('09:00');await day.locator('select').nth(1).selectOption('18:00');
 await page.getByRole('button',{name:'Send request',exact:true}).click();await expect(page.getByRole('status')).toContainText('Request sent');
 const managerContext=await context.browser().newContext({baseURL:c.appUrl,httpCredentials:{username:'tester',password:c.accessPassword,origin:c.appUrl}});await managerContext.addCookies((await context.cookies()).filter(x=>x.name==='barber_test_access'));
 const manager=await managerContext.newPage();await login(manager,m.email);await expect(manager).toHaveURL(/\/dashboard$/);
 await manager.goto('/dashboard/availability-requests');const row=manager.locator('.availability-request-row').filter({hasText:b.name});await expect(row).toBeVisible();
 await row.getByRole('button',{name:'Approve',exact:true}).click();await expect(row).toHaveCount(0);
 await manager.screenshot({path:'.cloud-test/invitation-manager-hours-approved.png',fullPage:true});
 await page.reload();await expect(page.locator('.schedule-row').first().locator('.schedule-toggle')).toHaveAttribute('aria-pressed','true');
 await managerContext.close();
});
