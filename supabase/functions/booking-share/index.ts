import 'jsr:@supabase/functions-js@2.89.0/edge-runtime.d.ts';
import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.89.0';
import {customerIdentity} from '../_shared/customer-session.ts';
import {createBookingShareHandler} from './handler.ts';
const secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const admin=createClient(Deno.env.get('SUPABASE_URL')||'',secret,{auth:{persistSession:false,autoRefreshToken:false}});
Deno.serve(createBookingShareHandler({
 environment:Deno.env.get('APP_ENV')||'',appUrl:Deno.env.get('APP_URL')||'',
 publicUrl:Deno.env.get('CUSTOMER_PUBLIC_API_URL')||Deno.env.get('CUSTOMER_BOOKING_TEST_API_URL')||'',secret,
 productionEnabled:Deno.env.get('CUSTOMER_ACCOUNTS_ENABLED')==='true',
 cloudTestProjectRef:Deno.env.get('CLOUD_TEST_PROJECT_REF'),cloudAccessKey:Deno.env.get('CLOUD_TEST_ACCESS_KEY'),
 identity:token=>customerIdentity(admin,token),
 rpc:async(action,data)=>{const result=await admin.rpc('customer_booking_share',{p_action:action,p_data:data});if(result.error)throw Error(result.error.message);return result.data;},
}));
