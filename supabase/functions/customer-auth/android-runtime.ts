export type AndroidRuntimeInput = { environment: string; appUrl: string; publicUrl?: string; androidEnabled?: boolean };
export type AndroidRuntime = { environment: 'cloud-test' | 'production'; apiUrl: string; appUrl: string; authOrigin: string; projectId: string; packageName: string };

// These are public deployment identities, never caller-selected Firebase or app
// identities. Existing Test behavior stays pinned; Live requires explicit opt-in.
export function androidRuntime(config: AndroidRuntimeInput): AndroidRuntime | null {
  if (config.environment === 'cloud-test' && config.appUrl === 'https://barber-test.alabdullah-cs.workers.dev'
    && config.publicUrl === 'https://qvkucvcjmojjbphlzlks.supabase.co') {
    return { environment: 'cloud-test', apiUrl: config.publicUrl, appUrl: config.appUrl,
      authOrigin: 'https://barber-auth-test.alabdullah-cs.workers.dev', projectId: 'barber-plus-plus-phone-test', packageName: 'com.barberplusplus.customer.test' };
  }
  if (config.environment === 'production' && config.androidEnabled === true && config.appUrl === 'https://www.barberplusplus.com'
    && config.publicUrl === 'https://srv1073968.hstgr.cloud') {
    return { environment: 'production', apiUrl: config.publicUrl, appUrl: config.appUrl,
      authOrigin: 'https://barber-auth.alabdullah-cs.workers.dev', projectId: 'barber-plus-plus-phone-prod', packageName: 'com.barberplusplus.customer' };
  }
  return null;
}
