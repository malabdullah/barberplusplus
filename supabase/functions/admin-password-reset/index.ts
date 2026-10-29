import "jsr:@supabase/functions-js@2.89.0/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.89.0';
import { getAppUrl } from '../_shared/environment.ts';
import { createAdminPasswordResetHandler } from './handler.ts';

const url = Deno.env.get('SUPABASE_URL') ?? '';
const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {auth:{persistSession:false,autoRefreshToken:false}});
Deno.serve(createAdminPasswordResetHandler({
  appUrl: getAppUrl(),
  authenticate: async authorization => {
    const client = createClient(url, anon, {global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
    const {data,error} = await client.auth.getUser(); return error ? null : data.user;
  },
  list: async page => {
    const {data,error} = await admin.auth.admin.listUsers({page,perPage:100});
    if (error) throw new Error('List unavailable');
    return {users:data.users,hasMore:data.users.length === 100};
  },
  get: async id => { const {data,error}=await admin.auth.admin.getUserById(id); return error ? null : data.user; },
  allow: async adminId => {
    const since = new Date(Date.now() - 3600_000).toISOString();
    const {count,error} = await admin.from('audit_logs').select('id', {count:'exact',head:true})
      .eq('admin_user_id', adminId).eq('action_type', 'password_reset_requested')
      .gte('created_at', since);
    return !error && count !== null && count < 10;
  },
  audit: async (adminId,targetId) => {
    const {error} = await admin.from('audit_logs').insert({admin_user_id:adminId,target_user_id:targetId,action_type:'password_reset_requested',target_entity_type:'user',target_entity_id:targetId,metadata:{source:'admin_password_reset'}});
    return !error;
  },
  update: async (id,password) => { const {error}=await admin.auth.admin.updateUserById(id,{password}); return !error; },
  complete: async (adminId,targetId) => {
    const {error} = await admin.from('audit_logs').insert({admin_user_id:adminId,target_user_id:targetId,action_type:'password_reset_completed',target_entity_type:'user',target_entity_id:targetId,metadata:{source:'admin_password_reset'}});
    return !error;
  },
}));
