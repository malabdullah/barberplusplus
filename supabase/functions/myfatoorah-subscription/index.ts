import 'jsr:@supabase/functions-js@2.89.0/edge-runtime.d.ts';
import { createTestBoundary } from '../_shared/test-boundary.ts';
import { createHandler, testProject, testSite } from './handler.ts';

const project = Deno.env.get('SUPABASE_URL') || '';
const site = Deno.env.get('APP_URL') || '';
const environment = Deno.env.get('APP_ENV') || '';
const projectRef = Deno.env.get('CLOUD_TEST_PROJECT_REF');
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const boundary = createTestBoundary({
  environment, appUrl: site, publicUrl: project, cloudTestProjectRef: projectRef,
  cloudAccessKey: Deno.env.get('CLOUD_TEST_ACCESS_KEY'),
});
const enabled = boundary.enabled && environment === 'cloud-test' && project === testProject && site === testSite;


async function rpc(name: string, apiKey: string, token: string, args: unknown) {
  const result = await fetch(testProject + '/rest/v1/rpc/' + name, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
    headers: { Authorization: 'Bearer ' + token, apikey: apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const data = await result.json();
  if (!result.ok) throw new Error(result.status === 401 || result.status === 403 ? 'MYFATOORAH_FORBIDDEN' : data.message);
  return data;
}

Deno.serve(enabled ? createHandler({
  token: Deno.env.get('MYFATOORAH_SANDBOX_TOKEN') || '',
  allowsStaff: req => boundary.allows(req),
  manager: (token, action, data) => rpc('myfatoorah_test_manager', anonKey, token, { p_action: action, p_data: data }),
  provider: (action, id, data) => rpc('myfatoorah_test_provider', serviceKey, serviceKey, { p_action: action, p_id: id, p_data: data }),
}) : () => new Response(null, { status: 404 }));
