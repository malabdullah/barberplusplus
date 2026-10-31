import 'jsr:@supabase/functions-js@2.89.0/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.89.0';
import { createCustomerAuthHandler } from './handler.ts';
import { sendTestEmail } from './test-mail.ts';
import { createCustomerEmailDelivery } from './email-delivery.ts';
import { customerIdentity, sessionId } from '../_shared/customer-session.ts';
const url=Deno.env.get('SUPABASE_URL') || '';
const environment=Deno.env.get('APP_ENV') || '';
const appUrl=Deno.env.get('APP_URL') || '';
const admin=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',{auth:{persistSession:false,autoRefreshToken:false}});
const emailClient=createClient(url,Deno.env.get('SUPABASE_ANON_KEY') || '',{auth:{persistSession:false,autoRefreshToken:false,flowType:'implicit'}});
const deliverEmail=createCustomerEmailDelivery(emailClient.auth,appUrl);
Deno.serve(createCustomerAuthHandler({
  environment,appUrl,publicUrl:Deno.env.get('CUSTOMER_PUBLIC_API_URL') || Deno.env.get('CUSTOMER_BOOKING_TEST_API_URL') || '',secret:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
  productionEnabled:Deno.env.get('CUSTOMER_ACCOUNTS_ENABLED')==='true',
  rpc:async(action,data)=>{
    const result=await admin.rpc('customer_account_api',{p_action:action,p_data:data});
    if(result.error)throw Error(result.error.message);
    if(action==='update-profile') {
      const changed=await admin.auth.admin.updateUserById(String(result.data.id),{user_metadata:{name:result.data.name}});
      if(changed.error)throw Error('UNAVAILABLE');
    }
    return result.data;
  },
  createUser:async(data)=>{const result=await admin.auth.admin.createUser({phone:String(data.phone_e164),password:String(data.password),phone_confirm:true,app_metadata:{role:'customer'},user_metadata:{name:data.name}});if(result.error || !result.data.user)throw Error('ACCOUNT_UNAVAILABLE');return result.data.user.id;},
  deleteUser:async(id)=>{const {error}=await admin.auth.admin.deleteUser(id);if(error)throw Error('UNAVAILABLE');},
  signIn:async(phone,password)=>{
    const client=createClient(url,Deno.env.get('SUPABASE_ANON_KEY') || '',{auth:{persistSession:false,autoRefreshToken:false}});
    const {data,error}=await client.auth.signInWithPassword({phone,password});
    if(error || !data.session){ console.warn('Customer sign-in rejected', error?.code || 'missing_session'); return null; }
    if(data.user.app_metadata.role!=='customer'){await admin.auth.admin.signOut(data.session.access_token,'local');return null;}
    return {session:data.session,identity:{user_id:data.user.id,session_id:sessionId(data.session.access_token)}};
  },
  emailSignup:async(name,email,password,returnTo)=>{
    const lookup=await admin.rpc('customer_account_api',{p_action:'email-lookup',p_data:{email}});
    if(lookup.error)throw Error('UNAVAILABLE');
    if(lookup.data) {
      if(!lookup.data.confirmed) {
        if(environment==='production') {await deliverEmail(email,'confirm',returnTo);return;}
        const link=await admin.auth.admin.generateLink({type:'magiclink',email});
        if(link.error)throw Error('UNAVAILABLE');
        await sendTestEmail(email,'Confirm your Barber++ account',`${Deno.env.get('APP_URL')}/customer/email-callback?type=magiclink&next=${returnTo}&token_hash=${encodeURIComponent(link.data.properties.hashed_token)}`);
      }
      return;
    }
    const created=await admin.auth.admin.createUser({email,password,email_confirm:false,app_metadata:{role:'customer'},user_metadata:{name}});
    if(created.error) return; // Generic response also protects staff and duplicate identities.
    if(environment==='production') {await deliverEmail(email,'confirm',returnTo);return;}
    const link=await admin.auth.admin.generateLink({type:'signup',email,password});
    if(link.error)throw Error('UNAVAILABLE');
    await sendTestEmail(email,'Confirm your Barber++ account',`${Deno.env.get('APP_URL')}/customer/email-callback?type=signup&next=${returnTo}&token_hash=${encodeURIComponent(link.data.properties.hashed_token)}`);
  },
  emailLink:async(email,purpose,returnTo)=>{
    const lookup=await admin.rpc('customer_account_api',{p_action:'email-lookup',p_data:{email}});
    if(lookup.error)throw Error('UNAVAILABLE');
    if(!lookup.data || (purpose==='recovery' && !lookup.data.confirmed) || (purpose==='confirm' && lookup.data.confirmed))return;
    if(environment==='production') {await deliverEmail(email,purpose,returnTo);return;}
    const type=purpose==='recovery'?'recovery':'magiclink';
    const link=await admin.auth.admin.generateLink({type,email});
    if(link.error)throw Error('UNAVAILABLE');
    const callback=`${Deno.env.get('APP_URL')}/customer/email-callback?type=${type}&next=${returnTo}&token_hash=${encodeURIComponent(link.data.properties.hashed_token)}`;
    await sendTestEmail(email,purpose==='recovery'?'Reset your Barber++ password':'Confirm your Barber++ account',callback);
  },
  emailSignIn:async(email,password)=>{
    const client=createClient(url,Deno.env.get('SUPABASE_ANON_KEY') || '',{auth:{persistSession:false,autoRefreshToken:false}});
    const {data,error}=await client.auth.signInWithPassword({email,password});
    if(error || !data.session)return null;
    if(data.user.app_metadata.role!=='customer' || !data.user.email_confirmed_at){await admin.auth.admin.signOut(data.session.access_token,'local');return null;}
    const name=typeof data.user.user_metadata?.name==='string'?data.user.user_metadata.name:'';
    return {session:data.session,identity:{user_id:data.user.id,session_id:sessionId(data.session.access_token)},name};
  },
  emailName:async(token)=>{
    const {data,error}=await admin.auth.getUser(token);
    if(error || data.user?.app_metadata.role!=='customer' || !data.user.email_confirmed_at)throw Error('AUTH_REQUIRED');
    const name=data.user.user_metadata?.name || data.user.user_metadata?.full_name;
    return typeof name==='string'?name.slice(0,120):'';
  },
  identity:token=>customerIdentity(admin,token),
  socialIdentity:async(token)=>{
    const identity=await customerIdentity(admin,token);
    if(!identity)return null;
    const {data,error}=await admin.auth.getUser(token);
    if(error || !data.user?.identities?.some(item=>['google','apple'].includes(item.provider)))return null;
    const name=data.user.user_metadata?.name || data.user.user_metadata?.full_name;
    return {...identity,name:typeof name==='string' ? name.slice(0,120) : ''};
  },
  resetPassword:async(id,password)=>{const {data,error}=await admin.auth.admin.getUserById(id);if(error || data.user.app_metadata.role!=='customer')throw Error('ACCOUNT_UNAVAILABLE');const result=await admin.auth.admin.updateUserById(id,{password});if(result.error)throw Error('UNAVAILABLE');},
}));
