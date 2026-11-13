import 'jsr:@supabase/functions-js@2.89.0/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.89.0';
import { withCloudTestGateway } from '../_shared/test-boundary.ts';
import { createReportHandler } from './handler.ts';

declare const EdgeRuntime: { waitUntil(task: Promise<unknown>): void };

Deno.serve(withCloudTestGateway(createReportHandler({
  appUrl: Deno.env.get('APP_URL') || '',
  waitUntil: task => EdgeRuntime.waitUntil(task),
  rpc: async (token, action, data) => {
    const client = createClient(Deno.env.get('SUPABASE_URL') || '', Deno.env.get('SUPABASE_ANON_KEY') || '', {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const result = await client.rpc('staff_reports', { p_action: action, p_data: data });
    if (result.error) throw Error(result.error.code?.startsWith('22') ? 'REPORT_INVALID_FILTER' : result.error.message);
    return result.data;
  },
})));
