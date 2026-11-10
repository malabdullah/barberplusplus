import 'jsr:@supabase/functions-js@2.89.0/edge-runtime.d.ts';
import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.89.0';
import {createBookingEmailHandler} from './handler.ts';
const admin=createClient(Deno.env.get('SUPABASE_URL')||'',Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'',{auth:{persistSession:false,autoRefreshToken:false}});
async function rpc(name:string,args={}){const{data,error}=await admin.rpc(name,args);if(error)throw Error('EmailQueueUnavailable');return data;}
Deno.serve(createBookingEmailHandler({
 environment:Deno.env.get('APP_ENV')||'',appUrl:Deno.env.get('APP_URL')||'',
 apiUrl:Deno.env.get('CUSTOMER_PUBLIC_API_URL')||Deno.env.get('CUSTOMER_BOOKING_TEST_API_URL')||'',
 configuration:()=>rpc('customer_booking_email_configuration'),claim:()=>rpc('customer_booking_email_claim',{p_limit:5}),
 validate:job=>rpc('customer_booking_email_validate',{p_id:job.id,p_lease:job.lease}),
 finish:async(job,status,id)=>{if(!await rpc('customer_booking_email_finish',{p_id:job.id,p_lease:job.lease,p_status:status,p_provider_id:id}))throw Error('EmailAcknowledgementUnavailable');},
 capture:async(id,email)=>{
  await rpc('cloud_test_mailbox',{p_action:'capture',p_data:{recipient:email.to[0],subject:email.subject,
   bookingEmail:{idempotencyKey:id,text:email.text,html:email.html}}});return 'captured-'+id;
 },
 send:async(id,email)=>{
  const key=Deno.env.get('RESEND_API_KEY');if(!key)throw Error('EmailNotConfigured');
  const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json','Idempotency-Key':'booking-update/'+id},body:JSON.stringify(email),signal:AbortSignal.timeout(12000)});
  const body=await response.json().catch(()=>({}));return{status:response.ok?200:response.status,id:typeof body.id==='string'?body.id:''};
 },
}));
