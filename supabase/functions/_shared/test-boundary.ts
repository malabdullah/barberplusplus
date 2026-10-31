type Configuration = {
  environment: string;
  appUrl: string;
  publicUrl: string;
  cloudTestProjectRef?: string;
  cloudAccessKey?: string;
};

function local(value: string): boolean {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol)
      && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      && !url.username && !url.password;
  } catch { return false; }
}

export function createTestBoundary(config: Configuration) {
  const isLocal = ['development', 'test'].includes(config.environment)
    && local(config.appUrl) && local(config.publicUrl);
  let isCloud = false;
  try {
    const app = new URL(config.appUrl);
    isCloud = config.environment === 'cloud-test'
      && /^[a-z]{20}$/.test(config.cloudTestProjectRef || '')
      && config.publicUrl === `https://${config.cloudTestProjectRef}.supabase.co`
      && app.protocol === 'https:' && app.origin === config.appUrl
      && !app.username && !app.password
      && (config.cloudAccessKey?.length || 0) >= 32;
  } catch { /* Invalid configuration fails closed. */ }
  return {
    enabled: isLocal || isCloud,
    async allows(req: Request) {
      const origin = req.headers.get('origin');
      if (isLocal) return !origin || local(origin) && new URL(origin).port === new URL(config.appUrl).port;
      if (!isCloud || origin && origin !== config.appUrl) return false;
      const actual = req.headers.get('x-cloud-test-key') || '';
      const encoder = new TextEncoder();
      const [a, b] = await Promise.all([actual, config.cloudAccessKey!].map(value => crypto.subtle.digest('SHA-256', encoder.encode(value))));
      const left = new Uint8Array(a); const right = new Uint8Array(b);
      let difference = 0;
      for (let index = 0; index < left.length; index++) difference |= left[index] ^ right[index];
      return difference === 0;
    },
  };
}

// The hosted test deployment verifies its gateway secret before running any
// handler. Privileged handlers still independently verify the staff JWT/role.
export function withCloudTestGateway(handler: (req: Request) => Response | Promise<Response>) {
  return async (req: Request) => {
    if (Deno.env.get('APP_ENV') === 'cloud-test') {
      const ref = Deno.env.get('CLOUD_TEST_PROJECT_REF');
      const boundary = createTestBoundary({
        environment:'cloud-test',appUrl:Deno.env.get('APP_URL') || '',
        publicUrl:Deno.env.get('SUPABASE_URL') || '',cloudTestProjectRef:ref,
        cloudAccessKey:Deno.env.get('CLOUD_TEST_ACCESS_KEY'),
      });
      if (!await boundary.allows(req)) return new Response('Unauthorized', {status:401});
    }
    return await handler(req);
  };
}
