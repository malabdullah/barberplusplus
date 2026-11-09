import 'jsr:@supabase/functions-js@2.89.0/edge-runtime.d.ts';
import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.89.0';
import {apnsToken,sendAPNs,type PushJob} from './apns.ts';
import {nativePushRuntime} from '../_shared/native-push-runtime.ts';
const runtime=nativePushRuntime({environment:Deno.env.get('APP_ENV')||'',appUrl:Deno.env.get('APP_URL')||'',
  publicUrl:Deno.env.get('CUSTOMER_PUBLIC_API_URL')||Deno.env.get('CUSTOMER_BOOKING_TEST_API_URL')||''});
const admin=createClient(Deno.env.get('SUPABASE_URL')||'',Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'',{auth:{persistSession:false,autoRefreshToken:false}});
type Configuration={dispatchSecret:string;privateKey:string;keyId:string;teamId:string;enabled:boolean;apiUrl:string;topic:string;environments:string[]};
let cachedConfig:{value:Configuration;expires:number}|undefined;
async function configuration():Promise<Configuration> {
  if(cachedConfig && cachedConfig.expires>Date.now()) return cachedConfig.value;
  const {data,error}=await admin.rpc('customer_push_configuration');
  if(error || !data) throw Error('ConfigurationUnavailable');
  cachedConfig={value:data,expires:Date.now()+60000};
  return data;
}
async function authorized(value:string,secret:string) {
  if(secret.length<32 || value.length>256) return false;
  const encoder=new TextEncoder();
  const a=new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value)));
  const b=new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(secret)));
  let difference=0; for(let i=0;i<a.length;i++) difference|=a[i]^b[i];
  return difference===0;
}
Deno.serve(async request=>{
  let stage='configuration';
  const reply=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
  if(request.method!=='POST' || !/^[0-9a-f]{64}$/.test(request.headers.get('x-push-secret')||'')) return reply(403,{error:'FORBIDDEN'});
  if(!runtime) return reply(503,{error:'PUSH_NOT_CONFIGURED'});
  try {
    const config=await configuration();
    if(!await authorized(request.headers.get('x-push-secret')||'',config.dispatchSecret||'')) return reply(403,{error:'FORBIDDEN'});
    if(config.apiUrl!==runtime.apiUrl || config.topic!==runtime.topic || !Array.isArray(config.environments)
      || !config.environments.length || config.environments.some(value=>!runtime.environments.includes(value))) return reply(503,{error:'PUSH_NOT_CONFIGURED'});
    if(!config.enabled || !config.privateKey || !/^[A-Z0-9]{10}$/.test(config.keyId) || !/^[A-Z0-9]{10}$/.test(config.teamId)) return reply(503,{error:'PUSH_NOT_CONFIGURED'});
    stage='provider-token';
    const jwt=await apnsToken(config.privateKey,config.keyId,config.teamId);
    stage='claim';
    const {data,error}=await admin.rpc('customer_push_claim',{p_limit:20});
    if(error) throw Error('QueueUnavailable');
    const jobs=data as PushJob[];
    stage='delivery';
    let accepted=0,failed=0;
    // Bounded concurrency, short network timeouts, and durable SQL leases.
    for(let offset=0;offset<jobs.length;offset+=5) {
      await Promise.all(jobs.slice(offset,offset+5).map(async job=>{
        const valid=await admin.rpc('customer_push_validate',{p_id:job.id,p_lease:job.lease});
        const result=valid.data===true && !valid.error ? await sendAPNs(job,jwt,fetch,{topic:config.topic,environments:config.environments}) : {status:409,reason:'Cancelled',apnsId:''};
        const finished=await admin.rpc('customer_push_finish',{p_id:job.id,p_lease:job.lease,p_status:result.status,p_reason:result.reason,p_apns_id:result.apnsId});
        if(finished.error) throw Error('QueueAcknowledgeUnavailable');
        if(result.status===200) accepted++; else failed++;
      }));
    }
    // Only aggregate operational values: no device tokens, keys or booking data.
    console.log(JSON.stringify({event:'customer_push_dispatch',claimed:jobs.length,accepted,failed}));
    return reply(200,{claimed:jobs.length,accepted,failed});
  } catch {
    console.error(JSON.stringify({event:'customer_push_dispatch_unavailable',stage}));
    return reply(503,{error:'PUSH_UNAVAILABLE',stage});
  }
});
