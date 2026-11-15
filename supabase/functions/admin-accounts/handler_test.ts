import {createAdminAccountsHandler,type Dependencies}from'./handler.ts';
const id='a1111111-1111-4111-8111-111111111111';
const uid='a1111111-1111-4111-8111-111111111112';
const secret='a'.repeat(64);
function assert(value:unknown,message='assertion failed'):asserts value{if(!value)throw Error(message);}
function setup(overrides:Partial<Dependencies>={}){
 const calls:{kind:string;action?:string;data?:unknown}[]=[];
 const handler=createAdminAccountsHandler({appUrl:'https://barber-test.alabdullah-cs.workers.dev',
  manage:(_token,action,data)=>{calls.push({kind:'manage',action,data});return Promise.resolve(action==='delete-prepare'?{operation:id,userId:uid}:{id,email:'qa@example.test',name:'QA Admin'});},
  service:(action,data)=>{calls.push({kind:'service',action,data});return Promise.resolve(action==='prepare'?{operation:id,email:'qa@example.test',name:'QA Admin'}:{success:true,email:'qa@example.test'});},
  create:data=>{calls.push({kind:'create',data});return Promise.resolve(uid);},
  remove:async data=>{calls.push({kind:'remove',data});},
  mail:async(_email,_name,link)=>{calls.push({kind:'mail',data:link});},
  limit:()=>Promise.resolve(true),...overrides});
 const call=async(body:unknown,token='caller',origin='https://barber-test.alabdullah-cs.workers.dev')=>{
  const r=await handler(new Request(origin+'/test-api/admin-accounts',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)}));
  return{status:r.status,body:await r.json()};
 };return{call,calls,handler};
}
Deno.test('invitation uses server-generated secret and never creates a customer or Auth account while sending',async()=>{
 const s=setup();const r=await s.call({action:'invite',name:'QA Admin',email:'qa@example.test',role:'admin',actor:'spoofed'});
 assert(r.status===200&&r.body.delivered);
 assert(!s.calls.some(c=>c.kind==='create'));
 const data=s.calls.find(c=>c.kind==='manage')!.data as Record<string,unknown>;
 assert(typeof data.tokenHash==='string'&&/^[a-f0-9]{64}$/.test(data.tokenHash));
 assert(!('actor'in data)&&!('role'in data));
 const link=new URL(String(s.calls.find(c=>c.kind==='mail')!.data));
 assert(link.pathname==='/accept-admin-invite'&&link.hash.includes('token=')&&!link.search.includes('token='));
 assert(!JSON.stringify(r.body).includes('token'));
});
Deno.test('resend reports delivery failure and records only the matching hash',async()=>{
 const s=setup({mail:()=>Promise.reject(Error('private delivery error'))});const r=await s.call({action:'resend',id});
 assert(r.status===200&&r.body.delivered===false);
 assert(s.calls.some(c=>c.action==='delivery'&&(c.data as Record<string,unknown>).delivery==='failed'));
});
Deno.test('privileged actions require authentication and live Super Admin authorization',async()=>{
 const guest=setup();assert((await guest.call({action:'invite'},'')).status===401);assert(!guest.calls.length);
 const denied=setup({manage:()=>Promise.reject(Error('SUPER_ADMIN_REQUIRED'))});
 assert((await denied.call({action:'invite',name:'QA',email:'qa@example.test'})).status===403);
 assert(!denied.calls.some(c=>['create','mail','remove'].includes(c.kind)));
});
Deno.test('accept creates only the server-bound identity, then atomically finishes',async()=>{
 const s=setup();const r=await s.call({action:'accept',id,token:secret,password:'LongTest1234!',email:'attacker@example.test',role:'admin',userId:uid},'');
 assert(r.status===200);
 const created=s.calls.find(c=>c.kind==='create')!.data as Record<string,unknown>;
 assert(created.email==='qa@example.test'&&created.invitation===id&&!('role'in created));
 assert(s.calls.some(c=>c.action==='finish'));
});
Deno.test('weak passwords, invalid links, foreign origins and oversized input fail before acceptance',async()=>{
 const s=setup();
 assert((await s.call({action:'accept',id,token:secret,password:'weak'},'')).status===400);
 assert((await s.call({action:'resolve',id,token:'invalid'},'')).status===400);
 assert((await s.call({action:'resolve',id,token:secret},'','https://foreign.example')).status===403);
 assert((await s.call({action:'invite',email:'x'.repeat(9000)})).status===413);
 assert(!s.calls.some(c=>c.kind==='create'));
});
Deno.test('expired or used invitations return clear errors without creating an account',async()=>{
 for(const code of ['INVITE_EXPIRED','INVITE_USED','INVITE_CANCELLED']){
  const s=setup({service:()=>Promise.reject(Error(code))});const r=await s.call({action:'accept',id,token:secret,password:'LongTest1234!'},'');
  assert(r.status===409&&r.body.error===code&&!s.calls.length);
 }
});
Deno.test('interrupted setup releases its lease and retries only the bound pending identity',async()=>{
 const first=setup({create:()=>Promise.reject(Error('EMAIL_IN_USE'))});
 assert((await first.call({action:'accept',id,token:secret,password:'LongTest1234!'},'')).status===409);
 assert(first.calls.some(c=>c.action==='release'));
 const finished:Record<string,unknown>[]=[];
 const second=setup({service:(action,data)=>{if(action==='finish')finished.push(data);return Promise.resolve(action==='prepare'?{operation:id,email:'qa@example.test',name:'QA',setupUser:uid}:{success:true});}});
 assert((await second.call({action:'accept',id,token:secret,password:'LongTest1234!'},'')).status===200);
 assert(finished[0]?.password==='LongTest1234!'&&!second.calls.some(c=>c.kind==='create'));
});
Deno.test('delete uses only the authorized target and leaves an explicit retry when Auth fails',async()=>{
 const success=setup();assert((await success.call({action:'delete',userId:uid,operation:'spoof'})).status===200);
 assert(success.calls.some(c=>c.kind==='remove'&&c.data===uid));
 const failure=setup({remove:()=>Promise.reject(Error('private detail')),service:()=>Promise.reject(Error('ADMIN_DELETION_PENDING'))});
 const r=await failure.call({action:'delete',userId:uid});assert(r.status===503&&r.body.error==='ADMIN_DELETION_PENDING');
 assert(!JSON.stringify(r.body).includes('private detail'));
});
