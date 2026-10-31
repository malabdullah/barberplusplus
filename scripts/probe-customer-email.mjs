import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { loadEnv } from 'vite';
import { createClient } from '@supabase/supabase-js';
import { localDockerProbe } from './local-docker-probe.mjs';
const env=loadEnv('development',process.cwd(),'VITE_');
assert.equal(env.VITE_SUPABASE_URL,'http://127.0.0.1:55321');
execFileSync('node',['scripts/local-test.mjs','status'],{stdio:'pipe'});
const docker=localDockerProbe();
const sql=text=>docker(['exec','-i','supabase_db_barber-local-test','psql','-X','-v','ON_ERROR_STOP=1','-At','-U','supabase_admin','-d','postgres'],{input:text});
const email=`email-probe-${randomUUID()}@example.test`;
const changedEmail=`changed-${email}`;
const phone='5'+String(Math.floor(Math.random()*10000000)).padStart(7,'0');
assert.equal(sql(`select count(*) from public.customers where phone='${phone}'`),'0');
const client=createClient(env.VITE_SUPABASE_URL,env.VITE_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false,flowType:'pkce'}});
const createdBookings=[];const messageIds=[];
async function call(action,data={},token='',fn='customer-auth') {
 const response=await fetch(`${env.VITE_SUPABASE_URL}/functions/v1/${fn}`,{method:'POST',headers:{apikey:env.VITE_SUPABASE_PUBLISHABLE_KEY,'Content-Type':'application/json',Origin:'http://localhost:5173',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify({action,...data}),signal:AbortSignal.timeout(20000)});
 return {status:response.status,data:await response.json()};
}
async function message(subject) {
 const response=await fetch('http://127.0.0.1:55324/api/v1/messages');const inbox=await response.json();
 const found=inbox.messages.find(item=>item.Subject===subject && item.To.some(recipient=>recipient.Address===email) && !messageIds.includes(item.ID));
 assert.ok(found,'local confirmation message is delivered');messageIds.push(found.ID);
 const detail=await(await fetch(`http://127.0.0.1:55324/api/v1/message/${found.ID}`)).json();
 const match=detail.Text.match(/http:\/\/localhost:5173\/customer\/email-callback\?[^\s]+/);assert.ok(match,'customer email callback link exists');
 const url=new URL(match[0]);return {type:url.searchParams.get('type'),token_hash:url.searchParams.get('token_hash')};
}
try {
 const signup=await call('email-signup',{name:'Email Probe Customer',email,password:'Short12!',returnTo:'/book'});assert.equal(signup.status,200,JSON.stringify(signup.data));
 assert.equal((await call('email-login',{email,password:'Short12!'})).status,401,'unconfirmed account cannot login');
 let link=await message('Confirm your Barber++ account');assert.equal(link.type,'signup');
 if(process.env.PROBE_RESEND==='1') {
  assert.equal((await call('email-resend',{email,returnTo:'/book'})).status,200);
  const resent=await message('Confirm your Barber++ account');assert.equal(resent.type,'magiclink');
  link=resent;
 }
 const verified=await client.auth.verifyOtp(link);assert.ifError(verified.error);assert.equal(verified.data.user.app_metadata.role,'customer');
 const reused=await client.auth.verifyOtp(link);assert.ok(reused.error,'used confirmation cannot be reused');
 assert.equal((await call('email-signup',{name:'Other Name',email,password:'Otherpass1!'})).status,200,'duplicate signup remains generic');
 const token=verified.data.session.access_token;const profile=await call('email-ensure',{},token);assert.equal(profile.status,200,JSON.stringify(profile.data));
 assert.equal(profile.data.profile.email,email);assert.equal(profile.data.profile.phone,null);
 assert.equal((await call('account-proof',{},token,'customer-booking')).status,400,'phone required to book');
 const saved=await call('update-profile',{name:'Email Probe Customer',countryCode:'+965',phone,email},token);assert.equal(saved.status,200,JSON.stringify(saved.data));
 assert.equal(saved.data.profile.phone,phone);
 const proof=await call('account-proof',{},token,'customer-booking');assert.equal(proof.status,200,JSON.stringify(proof.data));
 const date=new Date(Date.now()+86400000).toISOString().slice(0,10);
 const selection={branchId:'10000000-0000-4000-8000-000000000012',barberId:'30000000-0000-4000-8000-000000000121',serviceIds:['20000000-0000-4000-8000-000000000121'],date};
 const slots=await call('slots',selection,'','customer-booking');assert.equal(slots.status,200);assert.ok(slots.data.slots.length);
 const booking=await call('book',{...selection,time:slots.data.slots[0],verification:proof.data.verification},token,'customer-booking');if(booking.data.id)createdBookings.push(booking.data.id);assert.equal(booking.status,200,JSON.stringify(booking.data));
 const mine=await call('bookings',{},token);assert.equal(mine.status,200);assert.ok(mine.data.bookings.some(item=>item.id===booking.data.id));
 const recovery=await call('email-recovery',{email,returnTo:'/book'});assert.equal(recovery.status,200,JSON.stringify(recovery.data));
 const resetLink=await message('Reset your Barber++ password');assert.equal(resetLink.type,'recovery');const recovered=await client.auth.verifyOtp(resetLink);assert.ifError(recovered.error);
 const reset=await call('email-reset',{password:'Newpass1!'},recovered.data.session.access_token);assert.equal(reset.status,200,JSON.stringify(reset.data));
 assert.equal((await call('profile',{},token)).status,401,'reset revokes old access session');
 assert.equal((await call('email-login',{email,password:'Short12!'})).status,401);
 const login=await call('email-login',{email,password:'Newpass1!'});assert.equal(login.status,200,JSON.stringify(login.data));assert.equal(login.data.profile.phone,phone);
 const setSession=await client.auth.setSession(login.data.session);assert.ifError(setSession.error);
 const changer=createClient(env.VITE_SUPABASE_URL,env.VITE_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false,flowType:'implicit'}});
 assert.ifError((await changer.auth.setSession(login.data.session)).error);
 const update=await changer.auth.updateUser({email:changedEmail},{emailRedirectTo:'http://localhost:5173/customer/email-callback'});assert.ifError(update.error);
 const pending=await client.auth.getUser();assert.equal(pending.data.user.email,email,'email remains unchanged before confirmation');
 const inbox=await(await fetch('http://127.0.0.1:55324/api/v1/messages')).json();
 const messages=inbox.messages.filter(item=>item.To.some(recipient=>[email,changedEmail].includes(recipient.Address)) && !messageIds.includes(item.ID));
 assert.equal(messages.length,2,'both addresses receive change confirmation');
 for(const item of messages){
  messageIds.push(item.ID);const detail=await(await fetch(`http://127.0.0.1:55324/api/v1/message/${item.ID}`)).json();
  const match=(detail.Text || detail.HTML).match(/https?:\/\/[^\s"<>]+/);assert.ok(match,'confirmation link exists');
  const response=await fetch(match[0],{redirect:'manual'});const location=response.headers.get('location');assert.ok(location,'confirmation redirects to app');
  const redirect=new URL(location);assert.equal(redirect.pathname,'/customer/email-callback');
  if(redirect.searchParams.has('code')){const result=await client.auth.exchangeCodeForSession(redirect.searchParams.get('code'));assert.ifError(result.error);}
  else if(redirect.hash){const fragment=new URLSearchParams(redirect.hash.slice(1));if(fragment.has('error'))assert.equal(fragment.get('error_code'),'otp_expired');if(fragment.has('access_token')){const result=await client.auth.setSession({access_token:fragment.get('access_token'),refresh_token:fragment.get('refresh_token')});assert.ifError(result.error);}}
 }
 const updated=await client.auth.getUser();assert.equal(updated.data.user.email,changedEmail,'email changes after confirmation');
 console.log('CUSTOMER_EMAIL_PASS: local email confirmation, role isolation, phone-optional profile, required phone, owned booking history, email recovery and session revocation');
} finally {
 await client.auth.signOut({scope:'local'}).catch(()=>{});
 for(const id of createdBookings){assert.match(id,/^[a-f0-9-]{36}$/);sql(`delete from public.bookings where id='${id}';`);}
 sql(`delete from auth.users where email in ('${email}','${changedEmail}') and raw_app_meta_data->>'role'='customer' and raw_user_meta_data->>'name'='Email Probe Customer';`);
 sql(`delete from public.customers where phone='${phone}' and name='Email Probe Customer';`);
 for(const id of messageIds)await fetch(`http://127.0.0.1:55324/api/v1/message/${id}`,{method:'DELETE'});
}
