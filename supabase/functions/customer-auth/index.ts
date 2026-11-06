import 'jsr:@supabase/functions-js@2.89.0/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.89.0';
import { createCustomerAuthHandler } from './handler.ts';
import { sendTestEmail } from './test-mail.ts';
import { createCustomerEmailDelivery } from './email-delivery.ts';
import { customerIdentity, sessionId } from '../_shared/customer-session.ts';
import { passwordCapableRoles } from './password.ts';
import { registrationUser } from './registration.ts';
const url=Deno.env.get('SUPABASE_URL') || '';
const environment=Deno.env.get('APP_ENV') || '';
const appUrl=Deno.env.get('APP_URL') || '';
// Hosted Test captures these same Auth-generated messages with its private hook.
const useAuthMail=environment==='production' || environment==='cloud-test';
const admin=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',{auth:{persistSession:false,autoRefreshToken:false}});
const emailClient=createClient(url,Deno.env.get('SUPABASE_ANON_KEY') || '',{auth:{persistSession:false,autoRefreshToken:false,flowType:'implicit'}});
const deliverEmail=createCustomerEmailDelivery(emailClient.auth,appUrl,environment);
Deno.serve(createCustomerAuthHandler({
  environment,appUrl,publicUrl:Deno.env.get('CUSTOMER_PUBLIC_API_URL') || Deno.env.get('CUSTOMER_BOOKING_TEST_API_URL') || '',secret:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
  productionEnabled:Deno.env.get('CUSTOMER_ACCOUNTS_ENABLED')==='true',
  cloudTestProjectRef:Deno.env.get('CLOUD_TEST_PROJECT_REF'),cloudAccessKey:Deno.env.get('CLOUD_TEST_ACCESS_KEY'),
  rpc:async(action,data)=>{
    const result=await admin.rpc(action.startsWith('favourites-') ? 'customer_favourites_api' : 'customer_account_api',{p_action:action,p_data:data});
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
    if(!['customer','manager','barber'].includes(data.user.app_metadata.role)){await admin.auth.admin.signOut(data.session.access_token,'local');return null;}
    return {session:data.session,identity:{user_id:data.user.id,session_id:sessionId(data.session.access_token)}};
  },
  emailSignup:async(name,email,password,returnTo)=>{
    const lookup=await admin.rpc('customer_account_api',{p_action:'email-lookup',p_data:{email}});
    if(lookup.error)throw Error('UNAVAILABLE');
    if(lookup.data) {
      if(!lookup.data.confirmed) {
        if(useAuthMail) {await deliverEmail(email,'confirm',returnTo);return;}
        const link=await admin.auth.admin.generateLink({type:'magiclink',email});
        if(link.error)throw Error('UNAVAILABLE');
        await sendTestEmail(email,'Confirm your Barber++ account',`${Deno.env.get('APP_URL')}/customer/email-callback?type=magiclink&next=${returnTo}&token_hash=${encodeURIComponent(link.data.properties.hashed_token)}`);
      }
      return;
    }
    const created=await admin.auth.admin.createUser({email,password,email_confirm:false,app_metadata:{role:'customer'},user_metadata:{name}});
    if(created.error) return; // Generic response also protects staff and duplicate identities.
    if(useAuthMail) {await deliverEmail(email,'confirm',returnTo);return;}
    const link=await admin.auth.admin.generateLink({type:'signup',email,password});
    if(link.error)throw Error('UNAVAILABLE');
    await sendTestEmail(email,'Confirm your Barber++ account',`${Deno.env.get('APP_URL')}/customer/email-callback?type=signup&next=${returnTo}&token_hash=${encodeURIComponent(link.data.properties.hashed_token)}`);
  },
  emailLink:async(email,purpose,returnTo)=>{
    const lookup=await admin.rpc('customer_account_api',{p_action:'email-lookup',p_data:{email}});
    if(lookup.error)throw Error('UNAVAILABLE');
    if(!lookup.data || (purpose==='recovery' && !lookup.data.confirmed) || (purpose==='confirm' && lookup.data.confirmed))return;
    if(useAuthMail) {await deliverEmail(email,purpose,returnTo);return;}
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
    if(!['customer','manager','barber'].includes(data.user.app_metadata.role) || !data.user.email_confirmed_at){await admin.auth.admin.signOut(data.session.access_token,'local');return null;}
    const name=typeof data.user.user_metadata?.name==='string'?data.user.user_metadata.name:'';
    return {session:data.session,identity:{user_id:data.user.id,session_id:sessionId(data.session.access_token)},name};
  },
  emailName:async(token)=>{
    const {data,error}=await admin.auth.getUser(token);
    if(error || !['customer','manager','barber'].includes(String(data.user?.app_metadata.role)) || !data.user.email_confirmed_at)throw Error('AUTH_REQUIRED');
    const name=data.user.user_metadata?.name || data.user.user_metadata?.full_name;
    return typeof name==='string'?name.slice(0,120):'';
  },
  identity:token=>customerIdentity(admin,token),
  emailManagement:{
    correct:async(input)=>{
      const {data,error}=await admin.rpc('correct_registration_email',{p_email:input.email,p_new_email:input.newEmail,p_password:input.password,p_audience:input.audience});
      if(error)throw Error(error.message);
      return data;
    },
    deliver:async(email,audience,returnTo)=>{
      const client=createClient(url,Deno.env.get('SUPABASE_ANON_KEY') || '',{auth:{persistSession:false,autoRefreshToken:false,flowType:'implicit'}});
      const callback=new URL('/customer/email-callback',appUrl);callback.searchParams.set('next',audience==='team'?'work':returnTo==='/book'?'book':'account');
      const {error}=await client.auth.resend({type:'signup',email,options:{emailRedirectTo:callback.href}});
      if(error)throw Error('UNAVAILABLE');
    },
    admin:async(token,action,data)=>{
      const client=createClient(url,Deno.env.get('SUPABASE_ANON_KEY') || '',{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false,autoRefreshToken:false}});
      const result=await client.rpc('admin_account_email',{p_action:action,p_data:data});
      if(result.error)throw Error(result.error.message);
      return result.data;
    },
  },
  registration:{
    signup:async(input)=>{
      const client=createClient(url,Deno.env.get('SUPABASE_ANON_KEY') || '',{auth:{persistSession:false,autoRefreshToken:false,flowType:'implicit'}});
      const {data,error}=await client.auth.signUp({email:input.email,password:input.password,options:{data:{name:input.name,phone:input.phone},emailRedirectTo:new URL('/customer/email-callback?next=work',appUrl).href}});
      if(error) {
        if(['user_already_exists','email_exists'].includes(String(error.code)) || /user already registered/i.test(error.message)) throw Error('SIGNUP_EMAIL_EXISTS');
        if(error.status===429) throw Error('RATE_LIMITED');
        if(/Database error saving new user/i.test(error.message)) throw Error('PHONE_REGISTRATION_CONFLICT');
        throw Error('UNAVAILABLE');
      }
      if(data.session) await client.auth.signOut({scope:'local'});
      return registrationUser(data.user);
    },
    user:async(id)=>{
      const {data,error}=await admin.auth.admin.getUserById(id);
      if(error?.status===404) return null;
      if(error || !data.user) throw Error('UNAVAILABLE');
      if(data.user.app_metadata?.role!=='manager') return null;
      return {id:data.user.id,email:(data.user.email || '').trim().toLowerCase(),verified:Boolean(data.user.email_confirmed_at)};
    },
    resend:async(email)=>{
      const client=createClient(url,Deno.env.get('SUPABASE_ANON_KEY') || '',{auth:{persistSession:false,autoRefreshToken:false,flowType:'implicit'}});
      const {error}=await client.auth.resend({type:'signup',email,options:{emailRedirectTo:new URL('/customer/email-callback?next=work',appUrl).href}});
      if(error) throw Error(error.status===429?'RATE_LIMITED':'UNAVAILABLE');
    },
  },
  passwords:{
    rpc:async(action,data)=>{
      const result=await admin.rpc('customer_password_api',{p_action:action,p_data:data});
      if(result.error)throw Error(result.error.message);
      return result.data;
    },
    reauthenticate:async(id,password)=>{
      const {data,error}=await admin.auth.admin.getUserById(id);
      if(error || !data.user || !passwordCapableRoles.has(String(data.user.app_metadata.role)))return null;
      const user=data.user;
      const client=createClient(url,Deno.env.get('SUPABASE_ANON_KEY') || '',{auth:{persistSession:false,autoRefreshToken:false}});
      const result=user.email ? await client.auth.signInWithPassword({email:user.email,password})
        : await client.auth.signInWithPassword({phone:user.phone || '',password});
      if(result.error || !result.data.session)return null;
      if(result.data.user.id!==id){await admin.auth.admin.signOut(result.data.session.access_token,'local');return null;}
      return {sessionId:sessionId(result.data.session.access_token),token:result.data.session.access_token};
    },
    discardReauthentication:async(token)=>{await admin.auth.admin.signOut(token,'local');},
    sendRecovery:async(email,callback)=>{
      const result=await emailClient.auth.resetPasswordForEmail(email,{redirectTo:callback});
      if(result.error)throw Error(result.error.status===429?'RATE_LIMITED':'UNAVAILABLE');
    },
    verifyRecovery:async(params)=>{
      const client=createClient(url,Deno.env.get('SUPABASE_ANON_KEY') || '',{auth:{persistSession:false,autoRefreshToken:false}});
      const result=params.tokenHash
        ? await client.auth.verifyOtp({type:params.type,token_hash:params.tokenHash})
        : await client.auth.verifyOtp({type:'recovery',email:params.email || '',token:params.code || ''});
      if(result.error || !result.data.session)return null;
      return result.data.session;
    },
    writePassword:async(id,password,operation)=>{
      const current=await admin.auth.admin.getUserById(id);
      if(current.error || !current.data.user || !passwordCapableRoles.has(String(current.data.user.app_metadata.role)))return {ok:false,definitive:true};
      const user=current.data.user;
      const result=await admin.auth.admin.updateUserById(id,{
        password,app_metadata:{barber_password_operation:operation},
        ...(user.email && user.email_confirmed_at && !user.identities?.some(identity=>identity.provider==='email') ? {email:user.email,email_confirm:true} : {}),
      });
      return {ok:!result.error,definitive:!result.error || (result.error.name!=='AuthRetryableFetchError' && Boolean(result.error.status)),code:result.error?.code};
    },
  },
  socialIdentity:async(token)=>{
    const {data,error}=await admin.auth.getUser(token);
    const session_id=sessionId(token);
    if(error || !data.user || !session_id)return null;
    const role=data.user.app_metadata.role;
    if(['admin','agent'].includes(String(role)))throw Error('STAFF_ACCOUNT');
    if(!['customer','manager','barber'].includes(String(role)) || !data.user.identities?.some(item=>['google','apple'].includes(item.provider)))return null;
    const name=data.user.user_metadata?.name || data.user.user_metadata?.full_name;
    return {user_id:data.user.id,session_id,name:typeof name==='string' ? name.slice(0,120) : ''};
  },
  resetPassword:async(id,password,guardId)=>{const {data,error}=await admin.auth.admin.getUserById(id);if(error || !['customer','manager','barber'].includes(data.user.app_metadata.role))throw Error('ACCOUNT_UNAVAILABLE');const result=await admin.auth.admin.updateUserById(id,{password,app_metadata:{barber_password_operation:guardId}});if(result.error)throw Error('UNAVAILABLE');},
}));
