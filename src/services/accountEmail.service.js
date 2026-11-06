import { supabase } from '../lib/supabase';
import { appConfig } from '../lib/runtimeConfig';
import { functionFetch } from '../lib/functionFetch';
async function request(action, data) {
  const {data:auth,error}=await supabase.auth.getSession();
  if(error || !auth.session)throw new Error('AUTH_REQUIRED');
  const response=await functionFetch(`${appConfig.supabaseUrl}/functions/v1/customer-auth`,{
    method:'POST',headers:{apikey:appConfig.supabasePublishableKey,Authorization:`Bearer ${auth.session.access_token}`,'Content-Type':'application/json'},
    body:JSON.stringify({action,...data}),signal:AbortSignal.timeout(20000),
  });
  const result=await response.json();
  if(!response.ok)throw new Error(result.error || 'UNAVAILABLE');
  return result;
}
export const accountEmailService={list:page=>request('admin-email-list',{page}),change:data=>request('admin-email-change',data)};
