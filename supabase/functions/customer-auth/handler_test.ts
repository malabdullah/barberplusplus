import {createCustomerAuthHandler} from './handler.ts';
const assert=(v:unknown,m='Assertion failed')=>{if(!v)throw Error(m);};
const make=(overrides={})=>createCustomerAuthHandler({environment:'test',appUrl:'http://localhost:5173',publicUrl:'http://127.0.0.1:55321',secret:'test-signing-secret-with-more-than-thirty-two-characters',rpc:async()=>null,createUser:async()=> 'account',deleteUser:async()=>{},signIn:async()=>({session:{access_token:'token'},identity:{user_id:'account',session_id:'session'}}),identity:async()=>null,resetPassword:async()=>{},...overrides});
const req=(body:unknown,origin='http://localhost:5173',token='')=>new Request('http://127.0.0.1:55321/functions/v1/customer-auth',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});
const details={name:'Customer Name',countryCode:'+965',phone:'5000-0099'};
const password='Short12!';
function fixture(overrides={}){
 let saved:Record<string,unknown>={};let used=false;const events:string[]=[];let created:Record<string,unknown>={};
 const handler=make({rpc:async(action:string,data:Record<string,unknown>)=>{
   events.push(action);
   if(action==='limit')return true;
   if(action==='issue'){saved=data;used=false;return{id:data.id};}
   if(action==='consume') {if(used || saved.code_hash!==data.code_hash || saved.purpose!==data.purpose)return null;used=true;return {...saved.payload as object,user_id:'account',guard_id:saved.id};}
   if(action==='profile')return {id:data.user_id,name:'Customer Name'};
   return {success:true};
 },createUser:async(data:Record<string,unknown>)=>{created=data;events.push('create-user');return 'account';},resetPassword:async()=>{events.push('password-updated');},...overrides});
 return{handler,events,get saved(){return saved;},get created(){return created;}};
}
Deno.test('customer accounts are restricted to local Test and approved origins',async()=>{
 for(const config of [{environment:'production'},{publicUrl:'https://remote.example'},{appUrl:''},{secret:''}])assert((await make(config)(req({action:'profile'}))).status===404);
 assert((await make()(req({action:'profile'},'https://untrusted.example'))).status===403);
 assert((await make()(req({action:'profile',padding:'x'.repeat(9000)}))).status===413);
});
Deno.test('production customer email access uses the approved HTTPS origin and never exposes Test code endpoints',async()=>{
 const options={environment:'production',productionEnabled:true,appUrl:'https://shop.example.test',publicUrl:'https://auth.example.test'};
 const handler=make(options);
 assert((await handler(req({action:'profile'},'https://shop.example.test'))).status===401);
 assert((await handler(req({action:'profile'},'https://other.example.test'))).status===403);
 for(const action of ['signup-code','recovery-code','signup','reset-password','login','social-code','social-complete']) {
  const response=await handler(req({action,...details},'https://shop.example.test'));
  assert(response.status===404);
  assert(!(await response.text()).includes('testCode'));
 }
});
Deno.test('signup accepts omitted email, binds verified details and never stores passwords in a challenge',async()=>{
 const f=fixture();const challenge=await(await f.handler(req({action:'signup-code',...details,email:'ignored@example.test',password,role:'admin'}))).json();
 assert(f.saved.purpose==='signup');assert((f.saved.payload as Record<string,unknown>).email==='');assert(!JSON.stringify(f.saved).includes(password));
 const result=await f.handler(req({action:'signup',challenge:challenge.challenge,code:challenge.testCode,password,name:'Forged',role:'admin'}));
 assert(result.status===200);assert(f.created.name==='Customer Name' && f.created.phone==='50000099');assert(!('role'in f.created));
 assert((await f.handler(req({action:'signup',challenge:challenge.challenge,code:challenge.testCode,password}))).status===400);
});
Deno.test('invalid code and weak password never create an account',async()=>{
 const f=fixture();const challenge=await(await f.handler(req({action:'signup-code',...details}))).json();
 assert((await f.handler(req({action:'signup',challenge:challenge.challenge,code:'000000',password}))).status===400);
 assert((await f.handler(req({action:'signup',challenge:challenge.challenge,code:challenge.testCode,password:'weak'}))).status===400);
 assert(!f.events.includes('create-user'));
});
Deno.test('recovery verifies its own purpose and revokes sessions after updating the password',async()=>{
 const f=fixture();const challenge=await(await f.handler(req({action:'recovery-code',...details}))).json();
 assert((await f.handler(req({action:'signup',challenge:challenge.challenge,code:challenge.testCode,password}))).status===400);
 assert((await f.handler(req({action:'reset-password',challenge:challenge.challenge,code:challenge.testCode,password}))).status===200);
 assert(f.events.indexOf('password-updated')<f.events.indexOf('finish-reset'));
});
Deno.test('uncertain password failures retain the recovery guard',async()=>{
 const f=fixture({resetPassword:async()=>{throw Error('uncertain update');}});const challenge=await(await f.handler(req({action:'recovery-code',...details}))).json();
 assert((await f.handler(req({action:'reset-password',challenge:challenge.challenge,code:challenge.testCode,password}))).status===503);
 assert(!f.events.includes('finish-reset'));
});
Deno.test('rate limits and invalid credentials fail without exposing accounts',async()=>{
 let attempts=0;
 const limited=make({rpc:async()=>false,signIn:async()=>{attempts++;return null;}});
 assert((await limited(req({action:'login',...details,password}))).status===429 && attempts===0);
 const f=fixture({signIn:async()=>null});assert((await f.handler(req({action:'login',...details,password}))).status===401);
});
Deno.test('profile ownership comes from verified identity, never request parameters',async()=>{
 const calls:Record<string,unknown>[]=[];
 const handler=make({identity:async()=>({user_id:'verified-customer',session_id:'verified-session'}),rpc:async(_action:string,data:Record<string,unknown>)=>{calls.push(data);return{};}});
 assert((await handler(req({action:'update-profile',name:'Updated Name',email:'',user_id:'victim',phone:'50000099',countryCode:'+965'},undefined,'token'))).status===200);
 assert(calls.every(data=>data.user_id==='verified-customer'&&data.session_id==='verified-session'));
 assert(calls[1].phone==='50000099' && calls[1].country_code==='+965');
 assert((await make()(req({action:'profile',user_id:'victim'}))).status===401);
});
Deno.test('failed linking removes only the newly created auth identity',async()=>{
 const deleted:string[]=[];const f=fixture({rpc:async(action:string,data:Record<string,unknown>)=>{
   if(action==='limit')return true;
   if(action==='issue')return {};
   if(action==='consume')return {...details,phone:'50000099',country_code:'+965',phone_e164:'+96550000099'};
   if(action==='link')throw Error('link failed');return data;
 },deleteUser:async(id:string)=>{deleted.push(id);}});
 assert((await f.handler(req({action:'signup',challenge:crypto.randomUUID(),code:'123456',password}))).status===503);
 assert(deleted.length===1&&deleted[0]==='account');
});

Deno.test('social status requires provider identity and phone linking is disabled',async()=>{
 assert((await make()(req({action:'social-status'}))).status===401);
 for(const action of ['social-code','social-complete'])assert((await make()(req({action,...details}))).status===404);
});
Deno.test('email signup uses a trusted gateway, validates details, and does not expose account existence',async()=>{
 const calls:unknown[][]=[];const f=fixture({emailSignup:async(...args:unknown[])=>{calls.push(args);}});
 assert((await f.handler(req({action:'email-signup',name:'Customer Name',email:' Test@Example.test ',password,role:'admin',returnTo:'/book'}))).status===200);
 assert(JSON.stringify(calls[0])===JSON.stringify(['Customer Name','test@example.test',password,'book']));
 assert((await f.handler(req({action:'email-signup',name:'Customer Name',email:'bad<@example.test',password}))).status===400);
 assert((await f.handler(req({action:'email-signup',name:'Customer Name',email:'test@example.test',password:'Abc12!x'}))).status===400);
});
Deno.test('email login and recovery enforce rate limits and authenticated identity',async()=>{
 const f=fixture({emailSignIn:async()=>null,emailLink:async()=>{},identity:async()=>null});
 assert((await f.handler(req({action:'email-login',email:'test@example.test',password}))).status===401);
 assert((await f.handler(req({action:'email-recovery',email:'test@example.test'}))).status===200);
 assert((await f.handler(req({action:'email-reset',password}))).status===401);
 const limited=make({rpc:async()=>false,emailLink:async()=>{throw Error('must not run');}});
 assert((await limited(req({action:'email-recovery',email:'test@example.test'}))).status===429);
});
Deno.test('customer passwords shorter than eight characters are rejected for signup and recovery',async()=>{
 for(const action of ['signup','reset-password'])assert((await make()(req({action,challenge:crypto.randomUUID(),code:'123456',password:'Abc12!x'}))).status===400);
});
