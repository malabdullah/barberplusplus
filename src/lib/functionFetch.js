import { appConfig } from './runtimeConfig';

// Hosted test Functions are reached through the authenticated test-site gateway.
// Auth, REST, Realtime and Storage continue to use the Supabase client directly.
export function functionFetch(input, init) {
  const url = typeof input === 'string' ? input : input.url || input.toString();
  const prefix = `${appConfig.supabaseUrl}/functions/v1/`;
  if (appConfig.environment === 'cloud-test' && url.startsWith(prefix)) {
    const target = `${window.location.origin}/test-api/${url.slice(prefix.length)}`;
    return fetch(input instanceof Request ? new Request(target, input) : target, init);
  }
  return fetch(input, init);
}
