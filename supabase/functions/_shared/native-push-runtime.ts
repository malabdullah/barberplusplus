type Runtime = { environment: string; appUrl: string; publicUrl: string };
export type NativePushRuntime = { apiUrl: string; topic: string; environments: string[] };

// Deployment identity is explicit. A client cannot select another app's topic,
// and Test can never register a production APNs token.
export function nativePushRuntime(config: Runtime): NativePushRuntime | null {
  if (config.environment === 'cloud-test'
    && config.appUrl === 'https://barber-test.alabdullah-cs.workers.dev'
    && config.publicUrl === 'https://qvkucvcjmojjbphlzlks.supabase.co') {
    return { apiUrl: config.publicUrl, topic: 'com.barberplusplus.customer.test', environments: ['sandbox'] };
  }
  if (config.environment === 'production'
    && config.appUrl === 'https://www.barberplusplus.com'
    && config.publicUrl === 'https://srv1073968.hstgr.cloud') {
    // Development-signed live builds use sandbox APNs with the live bundle ID.
    // Database provisioning separately controls which environment is activated.
    return { apiUrl: config.publicUrl, topic: 'com.barberplusplus.customer', environments: ['sandbox', 'production'] };
  }
  return null;
}
