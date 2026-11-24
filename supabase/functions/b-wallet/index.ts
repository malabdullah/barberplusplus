import 'jsr:@supabase/functions-js@2.89.0/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2.89.0';
import { customerIdentity } from '../_shared/customer-session.ts';
import { createTestBoundary } from '../_shared/test-boundary.ts';
import { createWalletHandler, walletProject, walletSite } from './handler.ts';

const token = Deno.env.get('UPAYMENTS_SANDBOX_TOKEN') || '';
const secret = Deno.env.get('UPAYMENTS_SANDBOX_HMAC') || '';
const environment = Deno.env.get('APP_ENV') || '';
const url = Deno.env.get('SUPABASE_URL') || '';
const appUrl = Deno.env.get('APP_URL') || '';
const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const boundary = createTestBoundary({ environment, appUrl, publicUrl: url,
  cloudTestProjectRef: Deno.env.get('CLOUD_TEST_PROJECT_REF'), cloudAccessKey: Deno.env.get('CLOUD_TEST_ACCESS_KEY') });
const active = environment === 'cloud-test' && url === walletProject && appUrl === walletSite
  && boundary.enabled && token && secret && key;
if (active) {
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  Deno.serve(createWalletHandler({ token, secret, allows: boundary.allows,
    identify: jwt => jwt ? customerIdentity(admin, jwt) : Promise.resolve(null),
    rpc: async (action, id, data) => {
      const result = await admin.rpc('b_wallet_topup_service', { p_action: action, p_id: id, p_data: data });
      if (result.error) throw Error(result.error.message);
      return result.data;
    },
  }));
} else Deno.serve(() => new Response(null, { status: 404 }));
