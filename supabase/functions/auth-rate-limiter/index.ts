import { withCloudTestGateway } from '../_shared/test-boundary.ts';
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.89.0';
import { getAppUrl } from '../_shared/environment.ts';
import { createAuthRateLimiterHandler } from './handler.ts';

serve(withCloudTestGateway(createAuthRateLimiterHandler({
  appUrl: getAppUrl(),
  checkLimit: async (parameters) => {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );
    return await supabase.rpc('check_auth_rate_limit', parameters);
  },
})));
