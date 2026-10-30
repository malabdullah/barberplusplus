import 'jsr:@supabase/functions-js@2.89.0/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.89.0';
import { createCustomerAuthHandler } from './handler.ts';
import { customerIdentity, sessionId } from '../_shared/customer-session.ts';
const url=Deno.env.get('SUPABASE_URL') || '';
const admin=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',{auth:{persistSession:false,autoRefreshToken:false}});
Deno.serve(createCustomerAuthHandler({
  environment:Deno.env.get('APP_ENV') || '',appUrl:Deno.env.get('APP_URL') || '',publicUrl:Deno.env.get('CUSTOMER_BOOKING_TEST_API_URL') || '',secret:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
  rpc:async(action,data)=>{
    const result=await admin.rpc('customer_account_api',{p_action:action,p_data:data});
    if(result.error)throw Error(result.error.message);
    if(action==='update-profile') {
      const changed=await admin.auth.admin.updateUserById(String(data.user_id),{user_metadata:{name:result.data.name}});
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
  identity:token=>customerIdentity(admin,token),
  resetPassword:async(id,password)=>{const {data,error}=await admin.auth.admin.getUserById(id);if(error || data.user.app_metadata.role!=='customer')throw Error('ACCOUNT_UNAVAILABLE');const result=await admin.auth.admin.updateUserById(id,{password});if(result.error)throw Error('UNAVAILABLE');},
}));
