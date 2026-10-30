import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {loadEnv} from 'vite';
import {createClient} from '@supabase/supabase-js';
import {localDockerProbe} from './local-docker-probe.mjs';
const env=loadEnv('development',process.cwd(),'VITE_');
assert.equal(env.VITE_SUPABASE_URL,'http://127.0.0.1:55321');
execFileSync('node',['scripts/local-test.mjs','status'],{stdio:'pipe'});
const docker=localDockerProbe();
const sql=text=>docker(['exec','-i','supabase_db_barber-local-test','psql','-X','-v','ON_ERROR_STOP=1','-A','-t','-U','supabase_admin','-d','postgres'],{input:text});
const phone='5'+String(Math.floor(Math.random()*10000000)).padStart(7,'0');
const phone2='9'+String(Math.floor(Math.random()*10000000)).padStart(7,'0');
assert.equal(sql(`select count(*) from public.customers where phone in ('${phone}','${phone2}')`),'0');
assert.equal(sql(`select count(*) from auth.users where ltrim(phone,'+') in ('965${phone}','965${phone2}')`),'0');
const password='LocalCustomer123!';const nextPassword='NewCustomer456!';
const users=[];const bookings=[];
async function call(action,data={},token='',fn='customer-auth') {
 const response=await fetch(`${env.VITE_SUPABASE_URL}/functions/v1/${fn}`,{method:'POST',headers:{apikey:env.VITE_SUPABASE_PUBLISHABLE_KEY,'Content-Type':'application/json',Origin:'http://localhost:5173',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify({action,...data}),signal:AbortSignal.timeout(20000)});
 return {status:response.status,data:await response.json()};
}
async function signup(number,email) {
 const challenge=await call('signup-code',{name:'Customer Auth Probe',countryCode:'+965',phone:number,...(email?{email}:{}),role:'admin'});
 assert.equal(challenge.status,200,JSON.stringify(challenge.data));
 assert.equal((await call('signup',{challenge:challenge.data.challenge,code:'000000',password})).status,400);
 const result=await call('signup',{challenge:challenge.data.challenge,code:challenge.data.testCode,password,role:'admin'});
 if(result.data.session?.user?.id)users.push(result.data.session.user.id);
 assert.equal(result.status,200,JSON.stringify(result.data));
 assert.equal(result.data.session.user.app_metadata.role,'customer');
 assert.equal((await call('signup',{challenge:challenge.data.challenge,code:challenge.data.testCode,password})).status,400,'code cannot replay');
 return result.data;
}
try {
 const one=await signup(phone);
 assert.equal(one.profile.email,null,'email is optional');
 const two=await signup(phone2,'optional@customer.test');
 assert.equal(two.profile.email,'optional@customer.test');
 const token=one.session.access_token;
 assert.equal((await call('profile',{},token)).data.profile.phone,phone);
 assert.equal((await call('profile')).status,401);
 const denied=await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/rpc/customer_account_api`,{method:'POST',headers:{apikey:env.VITE_SUPABASE_PUBLISHABLE_KEY,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({p_action:'lookup',p_data:{phone_e164:'+965'+phone2}})});
 assert.ok(!denied.ok,'customers cannot call privileged gateway');
 const profile=await call('update-profile',{name:'Updated Customer',email:'',user_id:two.profile.id},token);
 assert.equal(profile.status,200);assert.equal(profile.data.profile.name,'Updated Customer');
 assert.equal((await call('profile',{},two.session.access_token)).data.profile.name,'Customer Auth Probe');
 const authClient=createClient(env.VITE_SUPABASE_URL,env.VITE_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 await authClient.auth.setSession(one.session);
 assert.ifError((await authClient.auth.updateUser({data:{role:'admin'}})).error);
 const staff=await authClient.from('branches').select('id');assert.ifError(staff.error);assert.equal(staff.data.length,0,'user metadata cannot elevate customer');
 const proof=await call('account-proof',{},token,'customer-booking');assert.equal(proof.status,200,JSON.stringify(proof.data));
 const date=new Date(Date.now()+86400000).toISOString().slice(0,10);
 const selection={branchId:'10000000-0000-4000-8000-000000000012',barberId:'30000000-0000-4000-8000-000000000121',serviceIds:['20000000-0000-4000-8000-000000000121'],date};
 const slots=await call('slots',selection,'','customer-booking');assert.equal(slots.status,200);
 const booking=await call('book',{...selection,time:slots.data.slots[0],verification:proof.data.verification,name:'Forged',phone:phone2},token,'customer-booking');
 if(booking.data.id)bookings.push(booking.data.id);
 assert.equal(booking.status,200,JSON.stringify(booking.data));
 const mine=await call('bookings',{},token);assert.equal(mine.status,200);assert.ok(mine.data.bookings.some(b=>b.id===booking.data.id));
 assert.equal((await call('bookings',{user_id:one.profile.id},two.session.access_token)).data.bookings.length,0);
 assert.equal((await call('login',{countryCode:'+965',phone,password:'WrongPassword123!'})).status,401);
 assert.equal((await call('login',{countryCode:'+965',phone,password})).status,200);
 const recovery=await call('recovery-code',{countryCode:'+965',phone});assert.equal(recovery.status,200);
 const reset=await call('reset-password',{challenge:recovery.data.challenge,code:recovery.data.testCode,password:nextPassword});assert.equal(reset.status,200,JSON.stringify(reset.data));
 assert.equal((await call('reset-password',{challenge:recovery.data.challenge,code:recovery.data.testCode,password})).status,400,'reset code single-use');
 assert.equal((await call('profile',{},token)).status,401,'old access session rejected');
 assert.equal((await call('account-proof',{},token,'customer-booking')).status,401);
 assert.equal((await call('book',{...selection,time:slots.data.slots[0],verification:proof.data.verification},token,'customer-booking')).status,401,'proof invalid after reset');
 assert.equal((await call('login',{countryCode:'+965',phone,password})).status,401);
 const newLogin=await call('login',{countryCode:'+965',phone,password:nextPassword});assert.equal(newLogin.status,200,'new password works');
 assert.equal((await call('logout',{},newLogin.data.session.access_token)).status,200);
 assert.equal((await call('profile',{},newLogin.data.session.access_token)).status,401,'logout invalidates current access session');
 assert.equal((await call('profile',{},two.session.access_token)).status,200,'logout does not affect another customer');
 const refresh=await fetch(`${env.VITE_SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,{method:'POST',headers:{apikey:env.VITE_SUPABASE_PUBLISHABLE_KEY,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:one.session.refresh_token})});
 assert.ok(!refresh.ok,'old refresh session revoked');
 console.log('CUSTOMER_AUTH_PASS: optional email signup, phone verification/login, code replay denial, profile ownership, role isolation, authenticated booking, private history, phone recovery, old-session revocation and new-password login');
} finally {
 for(const id of bookings){assert.match(id,/^[0-9a-f-]{36}$/);sql(`delete from public.bookings where id='${id}';`);}
 sql(`delete from auth.users where ltrim(phone,'+') in ('965${phone}','965${phone2}') and raw_app_meta_data->>'role'='customer' and raw_user_meta_data->>'name'='Customer Auth Probe';`);
 for(const id of users){assert.match(id,/^[0-9a-f-]{36}$/);sql(`delete from auth.users where id='${id}';`);}
 // These phones were confirmed absent before the probe. No existing data touched.
 sql(`delete from public.customers where phone in ('${phone}','${phone2}');`);
}
