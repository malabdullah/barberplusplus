import {emailManagementAction,type EmailManagementDependencies} from './email-management.ts';
const equal=(actual:unknown,expected:unknown)=>{if(JSON.stringify(actual)!==JSON.stringify(expected))throw Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);};
const id='d0000000-0000-4000-8000-000000000001';
function setup(){
 let allow=true;let failure='';let mailFailure=false;let corrections=0;let sends=0;let admins=0;
 const deps:EmailManagementDependencies={correct:async()=>{corrections++;if(failure)throw Error(failure);return{id,email:'correct@example.test',verified:false};},deliver:async()=>{sends++;if(mailFailure)throw Error('private-delivery-detail');},admin:async()=>{admins++;if(failure)throw Error(failure);return{success:true};}};
 const call=(action='correct-registration-email',body:Record<string,unknown>={email:'wrong@example.test',newEmail:'correct@example.test',password:'Synthetic12!',audience:'team'},token='')=>emailManagementAction({action,body,token,ip:'127.0.0.1',secret:'a'.repeat(40),appUrl:'https://test.example',deps,limit:async()=>allow});
 return{call,deny:()=>{allow=false;},fail:(message:string)=>{failure=message;},mailFail:()=>{mailFailure=true;},counts:()=>({corrections,sends,admins})};
}
Deno.test('unverified correction issues a fresh manager receipt and sends to the corrected address',async()=>{
 const t=setup();const r=await t.call();equal(r.status,200);const b=r.body as Record<string,unknown>;equal(b.email,'correct@example.test');equal(b.delivered,true);equal(typeof b.receipt,'string');equal('session' in b,false);equal(t.counts(),{corrections:1,sends:1,admins:0});
});
Deno.test('invalid, rate-limited, wrong-password, confirmed and duplicate registrations do not send',async()=>{
 const t=setup();equal((await t.call('correct-registration-email',{email:'bad'})).status,400);equal(t.counts().corrections,0);
 t.deny();equal((await t.call()).status,429);equal(t.counts().corrections,0);
 for(const failure of ['REGISTRATION_CANNOT_CORRECT','EMAIL_IN_USE','EMAIL_ADMIN_ONLY']){const other=setup();other.fail(failure);equal((await other.call()).status,failure==='EMAIL_ADMIN_ONLY'?403:400);equal(other.counts().sends,0);}
});
Deno.test('delivery failure preserves a successful correction for retry through resend',async()=>{
 const t=setup();t.mailFail();const r=await t.call();equal(r.status,200);equal((r.body as Record<string,unknown>).delivered,false);equal(typeof (r.body as Record<string,unknown>).receipt,'string');
});
Deno.test('customer correction does not expose a manager status receipt',async()=>{
 const t=setup();const r=await t.call('correct-registration-email',{email:'wrong@example.test',newEmail:'correct@example.test',password:'Synthetic12!',audience:'customer'});equal(r.status,200);equal('receipt' in (r.body as object),false);
});
Deno.test('admin operations require authentication, validate pagination and preserve server authorization',async()=>{
 const t=setup();equal((await t.call('admin-email-list',{page:1})).status,401);equal(t.counts().admins,0);
 equal((await t.call('admin-email-list',{page:0},'token')).status,400);equal(t.counts().admins,0);
 t.fail('FORBIDDEN');equal((await t.call('admin-email-list',{page:1},'manager-token')).status,403);
 const a=setup();equal((await a.call('admin-email-change',{userId:id,newEmail:'new@example.test',expectedEmail:'old@example.test',reason:'Verified with customer'},'admin-token')).status,200);
 a.fail('ADMIN_MFA_REQUIRED');equal((await a.call('admin-email-list',{page:1},'aal1-admin-token')).status,403);
});
