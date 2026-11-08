import fs from 'node:fs';
import {test,expect} from './fixtures.js';
const c=JSON.parse(fs.readFileSync('.cloud-test/credentials.json'));
const m=JSON.parse(fs.readFileSync('.cloud-test/manager-review-fixture.json'));
test('pending invite rejects the wrong account and occupied phone, enforces resend cooldown and cancels',async({page,request,context})=>{
 const email='invitation-pending-'+Date.now()+'@example.test';
 await page.goto('/login');await page.locator('#email').fill(m.email);await page.locator('#password').fill(c.staffPassword);await page.locator('button[type="submit"]').click();await expect(page).toHaveURL(/\/dashboard$/);
 await page.goto('/dashboard/barbers/new');await page.locator('#invite-email').fill(email);await page.locator('form button[type="submit"]').click();await expect(page).toHaveURL(/\/dashboard\/barbers$/);
 const inbox=await(await request.get('/test-inbox?format=json')).json();const message=inbox.find(x=>x.recipient===email&&x.link?.includes('/accept-invite?'));expect(message).toBeTruthy();
 await page.goto(message.link);await expect(page.getByRole('button',{name:'Use the invited account',exact:true})).toBeVisible();await page.goto('/dashboard/barbers');
 const recipient=await context.browser().newContext({baseURL:c.appUrl,httpCredentials:{username:'tester',password:c.accessPassword,origin:c.appUrl}});await recipient.addCookies((await context.cookies()).filter(x=>x.name==='barber_test_access'));
 const p=await recipient.newPage();await p.goto(message.link);await p.locator('#join-name').fill('Pending Invitation QA');await p.locator('#join-phone').fill(m.phone);await p.locator('#join-password').fill(c.staffPassword);await p.locator('#join-confirmPassword').fill(c.staffPassword);await p.locator('form button[type="submit"]').click();await expect(p.getByRole('alert')).toContainText('already in use');
 await p.screenshot({path:'.cloud-test/invitation-phone-error.png',fullPage:true});
 const row=page.locator('.invitation-row').filter({hasText:email});await row.getByRole('button',{name:'Resend',exact:true}).click();await expect(page.locator('.barber-invitations').getByRole('alert')).toContainText('wait');
 await row.getByRole('button',{name:'Cancel invitation',exact:true}).click();await page.getByRole('alertdialog').getByRole('button',{name:'Cancel invitation',exact:true}).click();await expect(row).toContainText('Cancelled');
 await p.reload();await expect(p.getByRole('alert')).toContainText('cancelled');await recipient.close();
});
