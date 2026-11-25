// Temporary hosted-Test capture harness; never a production entrypoint.
import 'jsr:@supabase/functions-js@2.89.0/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2.89.0';
import { createTestBoundary } from '../../../supabase/functions/_shared/test-boundary.ts';
import { customerIdentity } from '../../../supabase/functions/_shared/customer-session.ts';
import { createAnnouncementDispatcher } from '../../../supabase/functions/admin-push-dispatch/handler.ts';
import type { AnnouncementJob } from '../../../supabase/functions/admin-push-dispatch/delivery.ts';
const project = 'qvkucvcjmojjbphlzlks';
const api = `https://${project}.supabase.co`;
const app = 'https://barber-test.alabdullah-cs.workers.dev';
const email = 'android-capture-20261125@example.test';
const marker = 'android-capture-20261125';
const admin = createClient(api, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '', {auth:{persistSession:false,autoRefreshToken:false}});
const boundary = createTestBoundary({environment:Deno.env.get('APP_ENV') || '',appUrl:app,publicUrl:api,cloudTestProjectRef:project,cloudAccessKey:Deno.env.get('CLOUD_TEST_ACCESS_KEY')});
const fixtureDevice = 'adab1125-0000-4000-8000-000000000014';
const fixtureSecret = 'a'.repeat(64); // Synthetic Test capability, never a real installation.
async function call(name:string,action:string,data:Record<string,unknown>) {
  const result=await admin.rpc(name,{p_action:action,p_data:data});
  if(result.error)throw Error('QA_RPC_FAILED');return result.data;
}
Deno.serve(async(request)=>{
  let stage='identity';
  const reply=(status:number,data:unknown)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
  if(Deno.env.get('APP_ENV')!=='cloud-test'||Deno.env.get('SUPABASE_URL')!==api||!await boundary.allows(request))return reply(403,{error:'FORBIDDEN'});
  if(request.method!=='POST')return reply(405,{error:'INVALID_REQUEST'});
  try{
    const body=await request.json();
    const token=request.headers.get('authorization')?.replace(/^Bearer /i,'')||'';
    const identity=await customerIdentity(admin,token);
    const account=token?await admin.auth.getUser(token):null;
    if(!identity||account?.data.user?.email!==email||account.data.user.app_metadata.qa_capture_run!==marker)return reply(403,{error:'FORBIDDEN'});
    const proof={...identity,deviceId:fixtureDevice,deviceSecret:fixtureSecret,version:1};
    if(body.action==='capture'){
      stage='profile';
      await call('customer_account_api','email-ensure',{...identity,name:'Notification capture QA 20261125'});
      stage='registration';
      // The isolated fixture registry entry is prepared separately. Never consume
      // the owner's existing Test allowlist or finite registration budget.
      await call('customer_android_push_api','push-status',proof);
      stage='announcement-enrollment';
      const registration=await call('customer_announcement_api','register',{...proof,client:'android',initializeDefaults:true});
      const job:AnnouncementJob={id:crypto.randomUUID(),lease:crypto.randomUUID(),campaignId:crypto.randomUUID(),recipientBinding:registration.recipientBinding,
       client:'android',environment:'cloud-test',deliveryMode:'capture',token:'synthetic-fcm-token-for-hosted-capture',projectId:'barber-plus-plus-phone-test',packageName:'com.barberplusplus.customer.test',topic:'',language:'en',titleEn:'Barber++ Test',bodyEn:'Capture only',titleAr:'',bodyAr:'',destination:'book',expiresAt:Date.now()/1000+600};
      const secret='d'.repeat(64);let external=0;let captured=0;
      const handler=createAnnouncementDispatcher({environment:'cloud-test',appUrl:app,publicUrl:api,
       configuration:async()=>({announcementEnabled:true,deliveryMode:'capture',announcementApiUrl:api,dispatchSecret:secret,apiUrl:api,topic:'com.barberplusplus.customer.test',environments:['sandbox'],privateKey:'',keyId:'',teamId:'',androidAnnouncementsEnabled:true}),
       claim:async()=>[job],continueWork:async()=>{},validate:async()=>{
        if(!await customerIdentity(admin,token))return false;
        await call('customer_android_push_api','push-status',proof);
        const binding=await call('customer_announcement_api','register',{...proof,client:'android'});
        return binding.recipientBinding===job.recipientBinding;
       },finish:async(_,r)=>{if(r.reason==='Captured')captured++;},
       providerToken:async()=>{external++;throw Error('NO_EXTERNAL_SENDS');},send:async()=>{external++;throw Error('NO_EXTERNAL_SENDS');},
       androidToken:async()=>{external++;throw Error('NO_EXTERNAL_SENDS');},sendAndroid:async()=>{external++;throw Error('NO_EXTERNAL_SENDS');}});
      const result=await handler(new Request(app,{method:'POST',headers:{'x-push-secret':secret}}));
      return reply(result.status,{...await result.json(),externalCalls:external,captureAcknowledgments:captured});
    }
    return reply(400,{error:'INVALID_REQUEST'});
  }catch{return reply(503,{error:'QA_FAILED',stage});}
});
