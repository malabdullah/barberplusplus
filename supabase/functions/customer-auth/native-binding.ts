import { androidRuntime, type AndroidRuntimeInput } from './android-runtime.ts';
type Data = Record<string, unknown>;
type Runtime = AndroidRuntimeInput;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function androidTestAuth(runtime: Runtime) { return androidRuntime(runtime)?.environment === 'cloud-test'; }
export function androidAuthEnabled(runtime: Runtime) { return androidRuntime(runtime) !== null; }

// Explicit client identity: Android must never borrow an iOS or web binding.
export async function nativeBinding(body: Data, verification: boolean, runtime: Runtime) {
  if (body.client !== undefined && !['ios', 'web', 'android'].includes(String(body.client))) throw Error('INVALID_REQUEST');
  if (body.client === 'android' && !androidAuthEnabled(runtime)) throw Error('INVALID_REQUEST');
  if (body.client !== 'ios' && body.client !== 'android') return { client: 'web' };
  if (!uuid.test(String(body.nativeState))) throw Error('INVALID_REQUEST');
  let challenge = String(body.nativeChallenge || '');
  if (verification) {
    if (typeof body.nativeVerifier !== 'string' || !/^[A-Za-z0-9_-]{43,128}$/.test(body.nativeVerifier)) throw Error('INVALID_CODE');
    const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body.nativeVerifier)));
    challenge = btoa(String.fromCharCode(...bytes)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  }
  if (!/^[A-Za-z0-9_-]{43}$/.test(challenge)) throw Error('NATIVE_CLIENT_UPDATE_REQUIRED');
  return { client: body.client, native_state: body.nativeState, native_challenge: challenge };
}
