import 'jsr:@supabase/functions-js@2.89.0/edge-runtime.d.ts';
import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.89.0';
import {withCloudTestGateway} from '../_shared/test-boundary.ts';
import {getAppUrl} from '../_shared/environment.ts';
import {sendTestEmail} from '../customer-auth/test-mail.ts';
import {createAdminAccountsHandler} from './handler.ts';
const url=Deno.env.get('SUPABASE_URL')||'';
const options={auth:{persistSession:false,autoRefreshToken:false}};
const admin=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'',options);
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
Deno.serve(withCloudTestGateway(createAdminAccountsHandler({
 appUrl:getAppUrl(),
 manage:async(token,action,data)=>{
  const caller=createClient(url,Deno.env.get('SUPABASE_ANON_KEY')||'',{...options,global:{headers:{Authorization:'Bearer '+token}}});
  const result=await caller.rpc('manage_administrators',{p_action:action,p_data:data});
  if(result.error)throw Error(result.error.message);return result.data;
 },
 service:async(action,data)=>{const r=await admin.rpc('admin_invitation_service',{p_action:action,p_data:data});if(r.error)throw Error(r.error.message);return r.data;},
 create:async(input)=>{
  const r=await admin.auth.admin.createUser({email:input.email,password:crypto.randomUUID()+'Aa1!',email_confirm:false,
   app_metadata:{role:'admin_invited',admin_invitation_id:input.invitation},user_metadata:{name:input.name}});
  if(r.error||!r.data.user)throw Error(['email_exists','user_already_exists'].includes(String(r.error?.code))?'EMAIL_IN_USE':'UNAVAILABLE');return r.data.user.id;
 },
 remove:async id=>{const r=await admin.auth.admin.deleteUser(id,true);if(r.error)throw Error('ADMIN_DELETION_PENDING');},
 limit:async(key,max)=>{const r=await admin.rpc('customer_account_api',{p_action:'limit',p_data:{key,max}});if(r.error)throw Error('UNAVAILABLE');return r.data===true;},
 mail:async(email,name,link,key)=>{
  if(Deno.env.get('APP_ENV')!=='production'){await sendTestEmail(email,'Your Barber++ Admin invitation',link);return;}
  const apiKey=Deno.env.get('RESEND_API_KEY');if(!apiKey)throw Error('EMAIL_UNAVAILABLE');
  const text='Hello '+name+',\nYou have been invited to join Barber++ as an Admin. Set your password and enable two-factor authentication:\n'+link+'\nThis single-use invitation expires in seven days.\nIf you did not expect this invitation, you can ignore it.\nSupport: support@barberplusplus.com';
  const html='<html lang="en"><body style="margin:0;background:#f6f4ef;font-family:Arial,sans-serif;color:#20201f"><main style="max-width:560px;margin:32px auto;padding:32px;background:#fff;border-radius:16px"><p style="font-size:24px;font-weight:bold">Barber<span style="color:#b98825">++</span></p><h1 style="font-size:28px">Your Admin invitation</h1><p>Hello '+escape(name)+',</p><p>You have been invited to join Barber++ as an Admin.</p><p><a style="display:inline-block;padding:16px 24px;background:#d4a853;color:#161616;border-radius:10px;font-weight:bold;text-decoration:none" href="'+escape(link)+'">Set up your Admin account</a></p><p>Set your password, then enable two-factor authentication. This single-use invitation expires in seven days.</p><p>If you did not expect this invitation, you can ignore it.</p><a href="mailto:support@barberplusplus.com">Contact support</a></main></body></html>';
  const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json','Idempotency-Key':'admin-invite/'+key},body:JSON.stringify({from:'Barber++ <noreply@barberplusplus.com>',reply_to:'support@barberplusplus.com',to:[email],subject:'Your Barber++ Admin invitation',text,html}),signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw Error('EMAIL_UNAVAILABLE');
 }
})));
