import { createAdminPasswordResetHandler } from './handler.ts';

const admin = {id:'10000000-0000-4000-8000-000000000001',app_metadata:{role:'admin'}};
const target = {id:'20000000-0000-4000-8000-000000000002',email:'user@barber.test',app_metadata:{role:'manager'}};
const valid = {action:'reset',userId:target.id,password:'SyntheticPass123!'};
const headers = {'Authorization':'Bearer synthetic','Origin':'https://barber.test','Content-Type':'application/json'};
function setup(overrides: Record<string, unknown> = {}) {
  const calls = {audit:0,update:0};
  const deps = {appUrl:'https://barber.test',authenticate:async()=>admin,
    list:async()=>({users:[admin,target,{...target,id:'30000000-0000-4000-8000-000000000003',app_metadata:{role:'admin'}}],hasMore:false}),
    get:async()=>target,allow:async()=>true,audit:async()=>{calls.audit++;return true;},update:async()=>{calls.update++;return true;},complete:async()=>true,...overrides};
  return {handler:createAdminPasswordResetHandler(deps),calls};
}
function request(body: unknown, header = headers) {return new Request('https://barber.test', {method:'POST',headers:header,body:JSON.stringify(body)});}
function equal(actual: unknown,expected: unknown) {if(JSON.stringify(actual)!==JSON.stringify(expected))throw new Error(`Expected ${expected}, received ${actual}`);}
Deno.test('admin can reset a non-admin after the audit record succeeds', async()=>{
 const {handler,calls}=setup();const r=await handler(request(valid));equal(r.status,200);equal(await r.json(),{success:true,auditComplete:true});equal(calls,{audit:1,update:1});
});
Deno.test('completion audit failure cannot misreport an already completed reset as failed',async()=>{const {handler}=setup({complete:async()=>false});const r=await handler(request(valid));equal(r.status,200);equal(await r.json(),{success:true,auditComplete:false});});
Deno.test('listed accounts omit admins, secrets, and unrelated metadata',async()=>{
 const {handler}=setup();const r=await handler(request({action:'list',page:1}));equal(r.status,200);equal(await r.json(),{users:[{id:target.id,email:target.email,role:'manager'}],hasMore:false});
});
Deno.test('phone-only non-admin accounts can be selected',async()=>{
 const phoneUser={id:'40000000-0000-4000-8000-000000000004',phone:'96500000000',app_metadata:{role:'customer'}};
 const {handler}=setup({list:async()=>({users:[phoneUser],hasMore:false})});const r=await handler(request({action:'list',page:1}));equal(await r.json(),{users:[{id:phoneUser.id,phone:phoneUser.phone,role:'customer'}],hasMore:false});
});
for(const caller of [null,{...admin,app_metadata:{role:'manager'}},{...admin,app_metadata:{role:'agent'}},{...admin,app_metadata:{}},{...admin,app_metadata:{},user_metadata:{role:'admin'}}]) {
 Deno.test(`untrusted caller denied ${JSON.stringify(caller)}`,async()=>{const {handler,calls}=setup({authenticate:async()=>caller});const r=await handler(request(valid));equal(r.status,caller ? 403 : 401);equal(calls,{audit:0,update:0});});
}
for(const user of [null,{...target,app_metadata:{role:'admin'}},{...target,app_metadata:{}},{...target,app_metadata:{role:'unknown'}}]) {
 Deno.test(`admin or unknown target denied ${JSON.stringify(user)}`,async()=>{const {handler,calls}=setup({get:async()=>user});equal((await handler(request(valid))).status,403);equal(calls,{audit:0,update:0});});
}
Deno.test('audit failure prevents changing the password',async()=>{const {handler,calls}=setup({audit:async()=>false});equal((await handler(request(valid))).status,503);equal(calls.update,0);});
Deno.test('rate-limit failure prevents changing the password',async()=>{const {handler,calls}=setup({allow:async()=>false});equal((await handler(request(valid))).status,429);equal(calls.update,0);});
for(const body of [{...valid,password:'weak'}, {...valid,password:'A1!'+ 'a'.repeat(80)}, {...valid,userId:admin.id}, {...valid,userId:'bad'}, {action:'list',page:0}, null]) {
 Deno.test(`invalid request rejected ${JSON.stringify(body)?.slice(0,50)}`,async()=>{const {handler,calls}=setup();const r=await handler(request(body));if(![400,403].includes(r.status))throw new Error('Invalid input accepted');equal(calls.update,0);});
}
Deno.test('hostile origin and oversized stream refused',async()=>{const {handler,calls}=setup();equal((await handler(request(valid,{...headers,Origin:'https://hostile.invalid'}))).status,403);equal((await handler(request({...valid,password:'x'.repeat(3000)}))).status,413);equal(calls.update,0);});
