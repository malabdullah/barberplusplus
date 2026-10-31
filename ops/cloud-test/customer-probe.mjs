import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
const state=JSON.parse(await fs.readFile('.cloud-test/credentials.json','utf8'));
assert.equal(state.projectRef,'qvkucvcjmojjbphlzlks','only the isolated hosted Test project is allowed');
assert.equal(state.appUrl,'https://barber-test.alabdullah-cs.workers.dev');
const keys=JSON.parse(await fs.readFile('.cloud-test/api-keys.json','utf8'));
const anon=keys.find(key=>key.name==='anon').api_key;
const url=`https://${state.projectRef}.supabase.co`;
const gate=await fetch(state.appUrl,{headers:{authorization:`Basic ${btoa(`tester:${state.accessPassword}`)}`}});
assert.equal(gate.status,200);
const cookie=gate.headers.get('set-cookie').split(';')[0];
const password='Short12!';const newPassword='Changed12!';
const email=`release-${randomUUID()}@example.test`;const secondEmail=`second-${email}`;const changedEmail=`changed-${email}`;
const phone='5'+String(Math.floor(Math.random()*10000000)).padStart(7,'0');
const authClient=()=>createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false,flowType:'implicit'}});
async function call(action,data={},token='',fn='customer-auth') {
 const response=await fetch(`${state.appUrl}/test-api/${fn}`,{method:'POST',headers:{cookie,Origin:state.appUrl,apikey:anon,'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify({action,...data}),signal:AbortSignal.timeout(25000)});
 return {status:response.status,data:await response.json()};
}
async function message(address,type) {
 const response=await fetch(`${state.appUrl}/test-inbox?format=json`,{headers:{cookie}});assert.equal(response.status,200);
 const messages=await response.json();const found=messages.find(m=>m.recipient===address && m.payload?.email_data?.email_action_type===type);
 assert.ok(found,`private Auth ${type} message captured`);return found.payload.email_data;
}
async function signup(address) {
 assert.equal((await call('email-signup',{name:'Hosted Release Customer',email:address,password})).status,200);
 assert.equal((await call('email-login',{email:address,password})).status,401,'unconfirmed password login is rejected');
 const mail=await message(address,'signup');const client=authClient();
 const verified=await client.auth.verifyOtp({type:'signup',token_hash:mail.token_hash});assert.ifError(verified.error);
 assert.equal(verified.data.user.app_metadata.role,'customer');
 assert.ok((await client.auth.verifyOtp({type:'signup',token_hash:mail.token_hash})).error,'used confirmation cannot be reused');
 const token=verified.data.session.access_token;
 const profile=await call('email-ensure',{},token);assert.equal(profile.status,200);assert.equal(profile.data.profile.phone,null);
 return {client,token};
}
const first=await signup(email);
assert.equal((await call('account-proof',{},first.token,'customer-booking')).status,400,'phone is required before booking');
assert.equal((await call('update-profile',{name:'Hosted Release Customer',countryCode:'+965',phone:'123'},first.token)).status,400,'invalid phone is rejected');
const saved=await call('update-profile',{name:'Hosted Release Customer',countryCode:'+965',phone},first.token);assert.equal(saved.status,200);
const proof=await call('account-proof',{},first.token,'customer-booking');assert.equal(proof.status,200);
const selection={branchId:'10000000-0000-4000-8000-000000000012',barberId:'30000000-0000-4000-8000-000000000121',serviceIds:['20000000-0000-4000-8000-000000000121'],date:new Date(Date.now()+2*86400000).toISOString().slice(0,10)};
const slots=await call('slots',selection,'','customer-booking');assert.equal(slots.status,200);assert.ok(slots.data.slots.length);
const details={...selection,time:slots.data.slots[0],verification:proof.data.verification};
const booking=await call('book',details,first.token,'customer-booking');assert.equal(booking.status,200);
assert.equal((await call('book',details,first.token,'customer-booking')).data.id,booking.data.id,'booking retries are idempotent');
assert.ok((await call('bookings',{},first.token)).data.bookings.some(b=>b.id===booking.data.id));
const second=await signup(secondEmail);
assert.equal((await call('update-profile',{name:'Hosted Release Customer',countryCode:'+965',phone},second.token)).status,200);
assert.deepEqual((await call('bookings',{},second.token)).data.bookings,[],'shared phone does not reveal another account history');
assert.notEqual((await call('book',details,second.token,'customer-booking')).status,200,'another account cannot reuse a booking proof');
assert.equal((await call('email-recovery',{email})).status,200);
const recovery=await message(email,'recovery');
const recovered=await first.client.auth.verifyOtp({type:'recovery',token_hash:recovery.token_hash});assert.ifError(recovered.error);
assert.equal((await call('email-reset',{password:newPassword},recovered.data.session.access_token)).status,200);
assert.equal((await call('profile',{},first.token)).status,401,'password reset revokes the previous session');
assert.equal((await call('email-login',{email,password})).status,401,'old password is rejected');
const login=await call('email-login',{email,password:newPassword});assert.equal(login.status,200);assert.equal(login.data.profile.phone,phone);
assert.ok((await call('bookings',{},login.data.session.access_token)).data.bookings.some(b=>b.id===booking.data.id),'booking remains after reset');
assert.ifError((await first.client.auth.setSession(login.data.session)).error);
assert.ifError((await first.client.auth.updateUser({email:changedEmail},{emailRedirectTo:`${state.appUrl}/customer/email-callback`})).error);
assert.equal((await first.client.auth.getUser()).data.user.email,email,'login email stays unchanged until confirmation');
const change=await message(changedEmail,'email_change');
for(const hash of [change.token_hash,change.token_hash_new].filter(Boolean)) {
 const verify=new URL(`${url}/auth/v1/verify`);verify.searchParams.set('type','email_change');verify.searchParams.set('token',hash);verify.searchParams.set('redirect_to',`${state.appUrl}/customer/email-callback`);
 const response=await fetch(verify,{redirect:'manual'});assert.equal(response.status,303);
 const target=new URL(response.headers.get('location'));assert.equal(target.origin,state.appUrl);assert.equal(target.pathname,'/customer/email-callback');
 const fragment=new URLSearchParams(target.hash.slice(1));assert.equal(fragment.has('error'),false);
 if(fragment.has('access_token'))assert.ifError((await first.client.auth.setSession({access_token:fragment.get('access_token'),refresh_token:fragment.get('refresh_token')})).error);
}
assert.equal((await first.client.auth.getUser()).data.user.email,changedEmail,'email changes after both confirmations');
assert.equal((await call('email-login',{email:changedEmail,password:newPassword})).status,200);
const report={checkedAt:new Date().toISOString(),emailConfirmation:true,trustedCustomerRole:true,phoneOptionalProfile:true,validPhoneRequiredForBooking:true,ownedBookingAndIdempotency:true,sharedPhoneHistoryIsolation:true,recoveryAndSessionRevocation:true,phoneAndBookingPreservedAfterReset:true,confirmedEmailChange:true,syntheticRecordsRetained:true};
await fs.writeFile('.cloud-test/customer-release-report.json',JSON.stringify(report,null,2),{mode:0o600});console.log(report);
