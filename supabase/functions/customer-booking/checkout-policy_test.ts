import { createCustomerBookingHandler } from './handler.ts';
const assert = (value: unknown) => { if (!value) throw Error('Assertion failed'); };
const origin = 'http://localhost:5173';
const request = (body: unknown, token = '') => new Request(origin, { method:'POST', headers:{ Origin:origin, ...(token ? { Authorization:'Bearer '+token } : {}) }, body:JSON.stringify(body) });
const selection = { branchId:'10000000-0000-4000-8000-000000000011',barberId:'30000000-0000-4000-8000-000000000111',serviceIds:['20000000-0000-4000-8000-000000000111'],date:'2027-01-02',time:'10:00' };
const account = { id:'account',session_id:'session',name:'Account Name',phone:'',countryCode:'+965',email:'account@example.test' };
const config = { environment:'test',appUrl:origin,publicUrl:'http://127.0.0.1:55321',secret:'checkout-policy-test-secret-over-thirtytwo',catalog:async()=>({}),checkoutPolicy:async():Promise<'standard'|'email_only'>=>'email_only',phone:{projectId:'test-project',apiKey:'private-key',appId:'app'},customer:async(token:string)=>token==='valid'?account:null,booking:async(_action:string,data:Record<string,unknown>)=>({id:data.id}) };
Deno.test('paused policy advertises email-only without exposing retained provider settings',async()=>{
 const handler=createCustomerBookingHandler(config);const response=await handler(request({action:'phone-config'}));const body=await response.json();
 assert(response.status===200&&body.phone===null&&!body.phoneVerificationRequired&&!body.phoneRequired&&body.emailRequired&&body.guestContactMode==='email'&&body.checkoutPolicy==='email_only');
 assert(!JSON.stringify(body).includes('private-key'));
 assert((await handler(request({action:'phone-start',phone:'+96550000099'}))).status===404);
 assert((await handler(request({action:'phone-confirm'}))).status===404);
});
Deno.test('signed-in email-only booking permits no phone, binds account and does not mark phone verified',async()=>{
 let input:Record<string,unknown>={};let marked=0;
 const handler=createCustomerBookingHandler({...config,accountPhone:async()=>{marked++;return true;},booking:async(_a,data)=>{input=data;return{id:data.id};}});
 assert((await handler(request({action:'account-proof'}))).status===401);
 const response=await handler(request({action:'account-proof',email:'forged@example.test'},'valid'));assert(response.status===200);
 const proof=await response.json();const payload=JSON.parse(atob(proof.verification.split('.')[0].replaceAll('-','+').replaceAll('_','/')));
 assert(payload.email===account.email&&payload.phone===''&&payload.phone_verified===false&&payload.account_contact==='email');
 assert((await handler(request({action:'book',...selection,verification:proof.verification,phone:'50000099'},'valid'))).status===200);
 assert(input.phone===''&&input.account_user_id==='account'&&input.session_id==='session'&&marked===0);
 assert((await handler(request({action:'book',...selection,verification:proof.verification},'expired'))).status===401);
});
Deno.test('paused mode rejects missing account email and new phone-only guest proofs',async()=>{
 const handler=createCustomerBookingHandler({...config,customer:async()=>({...account,email:''})});
 assert((await handler(request({action:'account-proof'},'valid'))).status===428);
 const response=await handler(request({action:'guest-proof',name:'Guest Name',phone:'50000099',countryCode:'+965'}));assert(response.status===428&&(await response.json()).error==='EMAIL_REQUIRED');
 assert((await handler(request({action:'guest-proof',contactMode:'email',name:'Guest Name',email:'guest@example.test',countryCode:'+965'}))).status===200);
});
Deno.test('policy lookup errors fail closed and restoring standard requires actual phone proof again',async()=>{
 let policy:'standard'|'email_only'='email_only';const handler=createCustomerBookingHandler({...config,checkoutPolicy:async()=>policy});
 const proof=await(await handler(request({action:'account-proof'},'valid'))).json();policy='standard';
 assert((await handler(request({action:'account-proof'},'valid'))).status===428);
 assert((await handler(request({action:'book',...selection,verification:proof.verification},'valid'))).status===428);
 const broken=createCustomerBookingHandler({...config,checkoutPolicy:async()=>{throw Error('private database error');}});
 const response=await broken(request({action:'account-proof'},'valid'));assert(response.status===503&&!JSON.stringify(await response.json()).includes('private database'));
});
Deno.test('legacy signed guest attempts recover and book without rebinding when enforcement is paused',async()=>{
 let policy:'standard'|'email_only'='standard';let input:Record<string,unknown>={};
 const handler=createCustomerBookingHandler({...config,phone:undefined,checkoutPolicy:async()=>policy,recover:async proof=>({id:proof.id,created_at:new Date().toISOString()}),booking:async(_a,data)=>{input=data;return{id:data.id};}});
 const proof=await(await handler(request({action:'guest-proof',name:'Legacy Guest',phone:'50000099',countryCode:'+965'}))).json();policy='email_only';
 assert((await handler(request({action:'book',...selection,verification:proof.verification,email:'new@example.test'}))).status===200);
 assert(input.phone==='50000099'&&input.email===undefined&&input.guest_contact===undefined);
 assert((await handler(request({action:'recover-booking',verification:proof.verification}))).status===200);
});
