import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {randomInt} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
const c=JSON.parse(await fs.readFile('.cloud-test/credentials.json'));assert.equal(c.projectRef,'qvkucvcjmojjbphlzlks');
const keys=JSON.parse(await fs.readFile('.cloud-test/api-keys.json'));const key=keys.find(k=>k.name==='anon').api_key;
const origin=c.appUrl;const url=`https://${c.projectRef}.supabase.co`;
const gate=await fetch(origin,{headers:{authorization:`Basic ${btoa(`tester:${c.accessPassword}`)}`}});assert.equal(gate.status,200);const cookie=gate.headers.get('set-cookie').split(';')[0];
async function call(action,data={},token='',fn='customer-auth') {const r=await fetch(`${origin}/test-api/${fn}`,{method:'POST',headers:{cookie,Origin:origin,apikey:key,'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify({action,...data})});return {status:r.status,data:await r.json()};}
const password=c.staffPassword;const fixtures=[];
for(let i=0;i<2;i++){
 const email=`booking-flow-${Date.now()}-${i}@example.test`;
 assert.equal((await call('email-signup',{name:`Booking Flow Customer ${i+1}`,email,password,returnTo:'/book'})).status,200);
 const inbox=await(await fetch(origin+'/test-inbox?format=json',{headers:{cookie}})).json();const mail=inbox.find(m=>m.recipient===email && m.payload?.email_data?.email_action_type==='signup');assert.ok(mail);
 const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const verified=await client.auth.verifyOtp({type:'signup',token_hash:mail.payload.email_data.token_hash});assert.ifError(verified.error);const token=verified.data.session.access_token;
 assert.equal((await call('email-ensure',{},token)).status,200);
 let phone; let p;
 for(let attempt=0;attempt<5;attempt++){phone='5884'+String(randomInt(10000)).padStart(4,'0');p=await call('update-profile',{name:`Booking Flow Customer ${i+1}`,phone,countryCode:'+965'},token);if(p.status===200)break;assert.equal(p.data.error,'PHONE_IN_USE');}
 assert.equal(p.status,200,'synthetic profile saved');
 fixtures.push({email,password,phone,profile:p.data.profile,session:verified.data.session});
}
await fs.writeFile('.cloud-test/flow-fixtures.json',JSON.stringify(fixtures),{mode:0o600});
const selection={branchId:'b6110203-0000-4000-8000-000000000001',barberId:'b6110205-0000-4000-8000-000000000001',serviceIds:['b6110204-0000-4000-8000-000000000011'],date:new Date(Date.now()+3*86400000).toLocaleDateString('en-CA',{timeZone:'Asia/Kuwait'})};
let slots;for(let day=1;day<14;day++){selection.date=new Date(Date.now()+day*86400000).toLocaleDateString('en-CA',{timeZone:'Asia/Kuwait'});slots=await call('slots',selection,'','customer-booking');assert.equal(slots.status,200);if(slots.data.slots.length>10)break;}assert.ok(slots.data.slots.length>10);
const proof=await call('guest-proof',{name:'Guest must not overwrite saved name',phone:fixtures[0].phone,countryCode:'+965'},'','customer-booking');assert.equal(proof.status,200);
const receipt=await call('book',{...selection,time:slots.data.slots.at(-1),verification:proof.data.verification},'','customer-booking');assert.equal(receipt.status,200);assert.ok(receipt.data.claimToken);
const token=fixtures[0].session.access_token;const other=fixtures[1].session.access_token;
const before=await call('bookings',{},token);assert.equal(before.status,200);assert.ok(!before.data.bookings.some(b=>b.id===receipt.data.id));
assert.equal((await call('claim-booking',{claimToken:receipt.data.claimToken},other,'customer-booking')).status,403);
assert.equal((await call('claim-booking',{claimToken:receipt.data.claimToken+'x'},token,'customer-booking')).status,403);
assert.equal((await call('claim-booking',{claimToken:proof.data.verification},token,'customer-booking')).status,403);
assert.equal((await call('claim-booking',{claimToken:receipt.data.claimToken},'','customer-booking')).status,401);
assert.equal((await call('claim-booking',{claimToken:receipt.data.claimToken},token,'customer-booking')).status,200);
assert.equal((await call('claim-booking',{claimToken:receipt.data.claimToken},token,'customer-booking')).status,200);
const after=await call('bookings',{},token);assert.ok(after.data.bookings.some(b=>b.id===receipt.data.id));
const profile=await call('profile',{},token);assert.equal(profile.data.profile.name,fixtures[0].profile.name);
// Same-contact second guest appointment stays private until its own receipt is claimed.
const proof2=await call('guest-proof',{name:'Another guest booking',phone:fixtures[0].phone,countryCode:'+965'},'','customer-booking');
const second=await call('book',{...selection,time:slots.data.slots.at(-5),verification:proof2.data.verification},'','customer-booking');assert.equal(second.status,200);
assert.ok(!(await call('bookings',{},token)).data.bookings.some(b=>b.id===second.data.id));
await fs.writeFile('.cloud-test/flow-http-report.json',JSON.stringify({status:'passed',selection,bookingIds:[receipt.data.id,second.data.id],claimedOnlyOne:true,wrongAccountDenied:true,tamperedDenied:true,requiresLogin:true,idempotent:true,profilePreserved:true},null,2),{mode:0o600});
console.log({status:'passed',accounts:fixtures.length,claimedOnlyOne:true,wrongAccountDenied:true,profilePreserved:true});
