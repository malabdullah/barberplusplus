import 'jsr:@supabase/functions-js@2.89.0/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.89.0';
import { withCloudTestGateway } from '../_shared/test-boundary.ts';
import { customerIdentity } from '../_shared/customer-session.ts';
import { getAppUrl } from '../_shared/environment.ts';
import { sendTestEmail } from '../customer-auth/test-mail.ts';
import { createInviteHandler } from './handler.ts';
const url=Deno.env.get('SUPABASE_URL') || '';
const admin=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',{auth:{persistSession:false,autoRefreshToken:false}});
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
Deno.serve(withCloudTestGateway(createInviteHandler({
 appUrl:getAppUrl(),
 identity:token=>customerIdentity(admin,token),
 limit:async(key,max)=>{
  const {data,error}=await admin.rpc('customer_account_api',{p_action:'limit',p_data:{key,max}});
  if(error)throw Error('UNAVAILABLE');return data===true;
 },
 rpc:async(action,data)=>{
  const result=await admin.rpc('shop_barber_invitation_api',{p_action:action,p_data:data});
  if(result.error)throw Error(result.error.message);return result.data;
 },
 createUser:async(input)=>{
  const {data,error}=await admin.auth.admin.createUser({email:input.email,password:input.password,email_confirm:false,
   // The atomic acceptance routine claims the phone together with the exact
   // managed profile. Claiming it while creating Auth would collide with that
   // profile's existing optional number before the invitation can attach it.
   app_metadata:{role:'customer',invitation_setup:input.invitation},user_metadata:{name:input.name}});
  if(error || !data.user)throw Error('ACCOUNT_CHANGED');return data.user.id;
 },
 mail:async(email,shop,link)=>{
  if(Deno.env.get('APP_ENV')!=='production'){await sendTestEmail(email,'Join '+shop+' on Barber++',link);return;}
  const key=Deno.env.get('RESEND_API_KEY');if(!key)throw Error('EMAIL_DELIVERY_FAILED');
  const result=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({
   from:'Barber++ <noreply@barberplusplus.com>',reply_to:'support@barberplusplus.com',to:[email],subject:'Join '+shop+' on Barber++',
   html:'<p>You have been invited to join <strong>'+escape(shop)+'</strong> as a barber.</p><p><a href="'+escape(link)+'">Accept invitation</a></p><p>This invitation expires in seven days. If you already have a customer account, sign in with that account to accept.</p>',
  }),signal:AbortSignal.timeout(15000)});
  if(!result.ok)throw Error('EMAIL_DELIVERY_FAILED');
 },
})));
