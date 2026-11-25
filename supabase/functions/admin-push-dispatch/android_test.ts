import assert from 'node:assert/strict';
import { androidAnnouncementPayload, sendAndroidAnnouncement } from './android.ts';
import { createAnnouncementDispatcher } from './handler.ts';
import type { AnnouncementJob } from './delivery.ts';
const job: AnnouncementJob = { id:crypto.randomUUID(),lease:crypto.randomUUID(),campaignId:crypto.randomUUID(),recipientBinding:'a'.repeat(64),
 deliveryMode:'capture',client:'android',token:'synthetic-fcm-token-for-capture',environment:'cloud-test',projectId:'barber-plus-plus-phone-test',
 packageName:'com.barberplusplus.customer.test',topic:'',language:'ar',titleEn:'Hello',bodyEn:'New appointments',titleAr:'مرحبا',bodyAr:'مواعيد جديدة',destination:'book',expiresAt:Math.floor(Date.now()/1000)+3600 };
const config={announcementEnabled:true,deliveryMode:'capture',announcementApiUrl:'https://qvkucvcjmojjbphlzlks.supabase.co',
 dispatchSecret:'d'.repeat(64),apiUrl:'https://qvkucvcjmojjbphlzlks.supabase.co',topic:'com.barberplusplus.customer.test',environments:['sandbox'],privateKey:'',keyId:'',teamId:'',androidAnnouncementsEnabled:true};
const runtime={environment:'cloud-test',appUrl:'https://barber-test.alabdullah-cs.workers.dev',publicUrl:config.apiUrl};
Deno.test('Android announcement uses frozen localized data-only envelope',()=>{
 const p=androidAnnouncementPayload(job);assert.deepEqual(p.message.data,{type:'announcement',version:'1',environment:'cloud-test',campaignId:job.campaignId,recipientBinding:job.recipientBinding,destination:'book',title:'مرحبا',body:'مواعيد جديدة'});
 assert.equal('notification'in p.message,false);assert.equal('notification'in p.message.android,false);
 assert.equal(p.message.android.restricted_package_name,job.packageName);
 assert.equal(androidAnnouncementPayload({...job,titleAr:'',bodyAr:''}).message.data.title,'Hello');
 for(const name of ['bookingId','deviceId','accountId','sessionId','email','token','lease'])assert.equal(name in p.message.data,false);
});
Deno.test('Android payload rejects cross-environment, invalid binding and oversized text',()=>{
 for(const input of [{...job,environment:'production'},{...job,packageName:'com.barberplusplus.customer'},{...job,recipientBinding:'bad'},{...job,destination:'https://evil.test'},{...job,expiresAt:1},{...job,titleAr:'a'.repeat(5000)}])assert.throws(()=>androidAnnouncementPayload(input));
});
Deno.test('Android capture validates installation and never calls APNs or FCM',async()=>{
 let external=0;let finished=0;
 const handler=createAnnouncementDispatcher({...runtime,configuration:async()=>config,claim:async()=>[job],validate:async()=>true,continueWork:async()=>{},finish:async(_,result)=>{assert.equal(result.reason,'Captured');finished++;},providerToken:async()=>{external++;return'token';},send:async()=>{external++;return{status:200,reason:'',providerId:''};}});
 const response=await handler(new Request(runtime.appUrl,{method:'POST',headers:{'x-push-secret':config.dispatchSecret}}));
 assert.deepEqual(await response.json(),{claimed:1,captured:1,accepted:0,other:0});assert.equal(finished,1);assert.equal(external,0);
});
Deno.test('disabled Android or mismatched eligibility is skipped without external delivery',async()=>{
 for(const allowed of [false,true]){
 let external=0;
 const handler=createAnnouncementDispatcher({...runtime,configuration:async()=>({...config,androidAnnouncementsEnabled:allowed}),claim:async()=>[job],validate:async()=>!allowed,continueWork:async()=>{},finish:async(_,r)=>{assert.equal(r.reason,'NoLongerEligible');},providerToken:async()=>{external++;return'';},send:async()=>{external++;return{status:200,reason:'',providerId:''};}});
 await handler(new Request(runtime.appUrl,{method:'POST',headers:{'x-push-secret':config.dispatchSecret}}));assert.equal(external,0);
 }
});

Deno.test('injected HTTP sender serializes the real data-only message and handles FCM responses',async()=>{
 let calls=0;
 const stub:typeof fetch=async(url,options)=>{
  calls++;assert.equal(String(url),'https://fcm.googleapis.com/v1/projects/barber-plus-plus-phone-test/messages:send');
  assert.deepEqual(JSON.parse(String(options?.body)),androidAnnouncementPayload(job));
  return Response.json({name:'projects/barber-plus-plus-phone-test/messages/synthetic-capture'});
 };
 assert.equal((await sendAndroidAnnouncement(job,'synthetic-not-a-provider-token',stub)).status,200);assert.equal(calls,1);
 const invalid=await sendAndroidAnnouncement(job,'synthetic',async()=>Response.json({error:{details:[{'@type':'type.googleapis.com/google.firebase.fcm.v1.FcmError',errorCode:'UNREGISTERED'}]}},{status:400}));
 assert.equal(invalid.status,410);
 assert.equal((await sendAndroidAnnouncement(job,'synthetic',async()=>{throw Error('offline stub');})).status,0);
 assert.equal((await sendAndroidAnnouncement(job,'synthetic',async()=>Response.json({error:{}},{status:403}))).status,403);
});
