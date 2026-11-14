import { withCloudTestGateway } from '../_shared/test-boundary.ts';
import "jsr:@supabase/functions-js@2.89.0/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.89.0';
import { getAppUrl } from '../_shared/environment.ts';
import { createAdminPasswordResetHandler } from './handler.ts';

const url = Deno.env.get('SUPABASE_URL') ?? '';
const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {auth:{persistSession:false,autoRefreshToken:false}});
Deno.serve(withCloudTestGateway(createAdminPasswordResetHandler({
  appUrl: getAppUrl(),
  authenticate: async authorization => {
    const client = createClient(url, anon, {global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
    const {data,error} = await client.auth.getUser();
    if (error || !data.user || data.user.app_metadata?.role !== 'admin') return null;
    const assurance = await client.rpc('enforce_account_session');
    return assurance.error ? null : data.user;
  },
  list: async page => {
    const {data,error} = await admin.auth.admin.listUsers({page,perPage:100});
    if (error) throw new Error('List unavailable');
    return {users:data.users,hasMore:data.users.length === 100};
  },
  get: async id => { const {data,error}=await admin.auth.admin.getUserById(id); return error ? null : data.user; },
  begin: async (adminId,targetId) => {
    const {data,error} = await admin.rpc('begin_admin_password_reset', {p_actor:adminId,p_target:targetId});
    return !error && typeof data === 'string' ? data : null;
  },
  update: async (id,password,guardId) => {
    const current=await admin.auth.admin.getUserById(id);
    if(current.error || !current.data.user)return false;
    const guarded=['customer','manager','barber'].includes(String(current.data.user.app_metadata.role));
    const {error}=await admin.auth.admin.updateUserById(id,{password,...(guarded?{app_metadata:{barber_admin_password_operation:guardId}}:{})});
    return !error;
  },
  complete: async (guardId,adminId,targetId) => {
    const {data,error} = await admin.rpc('finish_admin_password_reset', {p_guard:guardId,p_actor:adminId,p_target:targetId});
    return !error && data === true;
  },
})));
