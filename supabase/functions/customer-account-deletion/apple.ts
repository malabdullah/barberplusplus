// Apple secrets/tokens stay server-side. No redirects, caller URLs or client IDs.
import { digest, receiptBox } from './handler.ts';
import { TEST_APP, TEST_API, PRODUCTION_APP, PRODUCTION_API, type DeletionConfiguration } from './configuration.ts';
type Data = Record<string, unknown>;
type Platform = 'ios' | 'web';
type Client = { clientId: string; clientSecret: string };
export type AppleConfiguration = { enabled: boolean; clients: Partial<Record<Platform, Client>>; encryptionKey: string; keyId: string };
const encoder = new TextEncoder();
const decode = (value: string) => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
function claims(value: string) { return JSON.parse(new TextDecoder().decode(decode(value))); }
// The parent configuration already verifies the exact internal backend binding.
// Cleanup-only mode must retain provider access for previously accepted jobs.
export function appleConfiguration(deployment: DeletionConfiguration, enabled: string | undefined, clients: string | undefined, key: string | undefined, clock = Date.now): AppleConfiguration {
  const disabled: AppleConfiguration = { enabled: false, clients: {}, encryptionKey: '', keyId: 'v1' };
  const test = deployment.mode === 'test' && deployment.appUrl === TEST_APP && deployment.publicUrl === TEST_API
    && deployment.functionUrl === TEST_API + '/functions/v1/customer-account-deletion';
  const production = deployment.mode === 'production' && deployment.appUrl === PRODUCTION_APP && deployment.publicUrl === PRODUCTION_API
    && deployment.functionUrl === PRODUCTION_API + '/functions/v1/customer-account-deletion';
  if ((!test && !production) || !deployment.enabled || !deployment.cleanupEnabled || enabled !== 'true' || !/^[0-9a-f]{64}$/.test(key || '')) return disabled;
  const expected = test
    ? { ios: 'com.barberplusplus.customer.test', web: 'com.barberplusplus.authentication.test.web' }
    : { ios: 'com.barberplusplus.customer', web: 'com.barberplusplus.authentication.prod.web' };
  try {
    const parsed = JSON.parse(clients || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.keys(parsed).some(k => !['ios', 'web'].includes(k))) return disabled;
    // Live is provisioned as one complete native/web pair, never a partial or
    // cross-environment credential set. Test retains its scoped pilot support.
    if (production && (!parsed.ios || !parsed.web)) return disabled;
    const valid: Partial<Record<Platform, Client>> = {};
    const now = Math.floor(clock() / 1000);
    for (const kind of ['ios', 'web'] as Platform[]) {
      const c = parsed[kind]; if (!c) continue;
      if (Object.keys(c).some(k => !['clientId', 'clientSecret'].includes(k)) || c.clientId !== expected[kind] || typeof c.clientSecret !== 'string' || c.clientSecret.length > 4096) return disabled;
      const parts = c.clientSecret.split('.');
      if (parts.length !== 3 || !/^[A-Za-z0-9_-]+$/.test(parts[2])) return disabled;
      const header = claims(parts[0]); const jwt = claims(parts[1]);
      if (header.alg !== 'ES256' || !/^[A-Z0-9]{10}$/.test(header.kid || '') || jwt.iss !== 'D49RFZQ6BT'
        || jwt.sub !== c.clientId || jwt.aud !== 'https://appleid.apple.com'
        || !Number.isSafeInteger(jwt.iat) || jwt.iat <= 0 || jwt.iat > now + 30
        || !Number.isSafeInteger(jwt.exp) || jwt.exp <= now + 60 || jwt.exp <= jwt.iat || jwt.exp - jwt.iat > 180 * 86400) return disabled;
      valid[kind] = { clientId: c.clientId, clientSecret: c.clientSecret };
    }
    return { enabled: Object.keys(valid).length > 0, clients: valid, encryptionKey: key!, keyId: 'v1' };
  } catch { return disabled; }
}
export function createAppleProvider(config: AppleConfiguration, fetcher: typeof fetch = fetch, clock = () => Date.now()) {
  let keys: JsonWebKey[] = []; let keyExpiry = 0;
  const available = (platform: Platform) => config.enabled && !!config.clients[platform];
  async function post(path: 'token' | 'revoke', platform: Platform, fields: Record<string, string>) {
    const client = config.clients[platform]; if (!available(platform) || !client) throw Error('APPLE_NOT_AVAILABLE');
    try {
      const response = await fetcher('https://appleid.apple.com/auth/' + path, { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: client.clientId, client_secret: client.clientSecret, ...fields }), signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw Error('APPLE_UNAVAILABLE');
      if (path === 'revoke') return {} as Data;
      const data = await response.text(); if (data.length > 32768) throw Error('APPLE_UNAVAILABLE'); return JSON.parse(data) as Data;
    } catch { throw Error('APPLE_UNAVAILABLE'); }
  }
  async function verify(token: string, platform: Platform, nonce?: string, fresh = false): Promise<string> {
    try {
      const parts = token.split('.'); if (parts.length !== 3 || token.length > 16384) throw Error();
      const header = claims(parts[0]); const body = claims(parts[1]);
      const now = Math.floor(clock() / 1000);
      if (header.alg !== 'RS256' || typeof header.kid !== 'string' || header.kid.length > 128 || body.iss !== 'https://appleid.apple.com' || body.aud !== config.clients[platform]?.clientId
        || typeof body.sub !== 'string' || !body.sub || body.sub.length > 255 || !Number.isFinite(body.exp) || body.exp <= now || !Number.isFinite(body.iat) || body.iat > now + 30 || (fresh && body.iat < now - 300)
        || (nonce !== undefined && body.nonce !== await digest(nonce))) throw Error();
      if (keyExpiry <= clock()) {
        const response = await fetcher('https://appleid.apple.com/auth/keys', { redirect: 'error', signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw Error('APPLE_UNAVAILABLE');
        const raw = await response.text(); if (raw.length > 32768) throw Error();
        const value = JSON.parse(raw); if (!Array.isArray(value.keys) || value.keys.length > 8) throw Error();
        keys = value.keys; keyExpiry = clock() + 3600000;
      }
      const jwk = keys.find((item: JsonWebKey & { kid?: string }) => item.kid === header.kid && item.kty === 'RSA' && item.use === 'sig' && (!item.alg || item.alg === 'RS256'));
      if (!jwk) { keyExpiry = 0; throw Error(); }
      const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
      if (!await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, decode(parts[2]), encoder.encode(parts[0] + '.' + parts[1]))) throw Error();
      return body.sub;
    } catch (error) { if (error instanceof Error && error.message === 'APPLE_UNAVAILABLE') throw error; throw Error('APPLE_PROOF_INVALID'); }
  }
  return {
    available,
    async register(platform: Platform, value: Data, subject: string, userId: string) {
      let result: Data;
      if (platform === 'web' && typeof value.providerRefreshToken === 'string') {
        result = await post('token', platform, { grant_type: 'refresh_token', refresh_token: value.providerRefreshToken });
        if (await verify(String(result.id_token || ''), platform) !== subject) throw Error('APPLE_PROOF_INVALID');
        result.refresh_token = value.providerRefreshToken;
      } else {
        if (await verify(String(value.identityToken || ''), platform, String(value.rawNonce || ''), true) !== subject) throw Error('APPLE_PROOF_INVALID');
        result = await post('token', platform, { grant_type: 'authorization_code', code: String(value.authorizationCode || '') });
        if (await verify(String(result.id_token || ''), platform, String(value.rawNonce || ''), true) !== subject) throw Error('APPLE_PROOF_INVALID');
      }
      if (typeof result.refresh_token !== 'string' || !result.refresh_token || result.refresh_token.length > 8192) throw Error('APPLE_UNAVAILABLE');
      const aad = userId + ':' + platform + ':' + subject;
      return { cipher: await receiptBox('apple-v1:' + config.encryptionKey, aad, result.refresh_token), key_id: config.keyId };
    },
    async revoke(task: Data) {
      const platform = task.platform as Platform;
      if (!available(platform) || task.key_id !== config.keyId) throw Error('APPLE_NOT_AVAILABLE');
      let token: string;
      try { token = await receiptBox('apple-v1:' + config.encryptionKey, String(task.user_id) + ':' + platform + ':' + String(task.subject), String(task.cipher), true); } catch { throw Error('APPLE_UNAVAILABLE'); }
      await post('revoke', platform, { token, token_type_hint: 'refresh_token' });
    },
  };
}
export function createAppleActions(deps: { provider: ReturnType<typeof createAppleProvider>; rpc: (action: string, data: Data) => Promise<Data> }) {
  return async (action: string, value: Data, trusted: Data): Promise<Data> => {
    const platform = value.platform as Platform;
    if (!['ios', 'web'].includes(platform)) throw Error('INVALID_REQUEST');
    const status = await deps.rpc('apple-subject', { ...trusted, platform });
    if (action === 'apple-status') return { available: deps.provider.available(platform), registered: status.registered === true, legacyManualFallback: status.registered !== true };
    if (!deps.provider.available(platform)) throw Error('APPLE_NOT_AVAILABLE');
    const refresh = platform === 'web' && typeof value.providerRefreshToken === 'string';
    if (platform === 'web' && !refresh) throw Error('INVALID_REQUEST');
    if (refresh ? !value.providerRefreshToken || String(value.providerRefreshToken).length > 8192 || ['identityToken','rawNonce','authorizationCode'].some(k => k in value)
      : typeof value.identityToken !== 'string' || value.identityToken.length > 16384 || typeof value.authorizationCode !== 'string' || !value.authorizationCode || value.authorizationCode.length > 4096 || typeof value.rawNonce !== 'string' || !/^[A-Za-z0-9._-]{16,128}$/.test(value.rawNonce)) throw Error('INVALID_REQUEST');
    if (typeof status.subject !== 'string' || !status.subject) throw Error('APPLE_PROOF_INVALID');
    const proof = await digest(String(refresh ? value.providerRefreshToken : value.authorizationCode));
    const reserved = await deps.rpc('apple-reserve', { ...trusted, platform, proof_hash: proof });
    const encrypted = await deps.provider.register(platform, value, status.subject, String(trusted.user_id));
    await deps.rpc('apple-store', { ...trusted, platform, attempt: reserved.attempt, subject: status.subject, ...encrypted });
    return { registered: true };
  };
}
