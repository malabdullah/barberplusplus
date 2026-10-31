// This job is deliberately separate from the website Worker and production.
const PROJECT = 'qvkucvcjmojjbphlzlks';
const CLIENT = 'com.barberplusplus.authentication.test.web';
const TEAM = 'D49RFZQ6BT';
const KEY = 'SPT3287JRA';
const DAY = 86400;
const STATE_KEY = 'apple-renewal-v1';
const encoder = new TextEncoder();
const algorithm = { name: 'ECDSA', hash: 'SHA-256' };
const encode = bytes => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
const decode = value => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));

async function signingKey(pem) {
  if (!pem?.includes('-----BEGIN PRIVATE KEY-----')) throw new Error('Missing Test signing key');
  return crypto.subtle.importKey('pkcs8', decode(pem.replace(/-----[A-Z ]+-----|\s/g, '')),
    { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
}

export async function createCredential(pem, now) {
  const key = await signingKey(pem);
  const header = encode(encoder.encode(JSON.stringify({ alg: 'ES256', kid: KEY })));
  const claims = { iss: TEAM, sub: CLIENT, aud: 'https://appleid.apple.com', iat: now, exp: now + 180 * DAY };
  const input = `${header}.${encode(encoder.encode(JSON.stringify(claims)))}`;
  const signature = new Uint8Array(await crypto.subtle.sign(algorithm, key, encoder.encode(input)));
  if (signature.length !== 64) throw new Error('Unexpected ES256 signature format');
  const jwt = `${input}.${encode(signature)}`;
  await validateCredential(jwt, pem);
  return { jwt, expiresAt: claims.exp };
}

export async function validateCredential(jwt, pem) {
  const parts = jwt?.split('.') || [];
  if (parts.length !== 3) throw new Error('Invalid stored Test credential');
  const header = JSON.parse(new TextDecoder().decode(decode(parts[0])));
  const claims = JSON.parse(new TextDecoder().decode(decode(parts[1])));
  if (header.alg !== 'ES256' || header.kid !== KEY || claims.iss !== TEAM || claims.sub !== CLIENT ||
      claims.aud !== 'https://appleid.apple.com' || !Number.isSafeInteger(claims.iat) ||
      !Number.isSafeInteger(claims.exp) || claims.exp - claims.iat !== 180 * DAY) {
    throw new Error('Credential is outside the Test Apple registration');
  }
  const jwk = await crypto.subtle.exportKey('jwk', await signingKey(pem));
  delete jwk.d;
  jwk.key_ops = ['verify'];
  const publicKey = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  if (!await crypto.subtle.verify(algorithm, publicKey, decode(parts[2]), encoder.encode(parts.slice(0, 2).join('.')))) {
    throw new Error('Invalid Test credential signature');
  }
  return claims;
}

function safeSettings(config) {
  const { external_apple_secret: _secret, ...rest } = config;
  return JSON.stringify(Object.fromEntries(Object.entries(rest).sort(([a], [b]) => a.localeCompare(b))));
}

export async function renew(env, { now = Math.floor(Date.now() / 1000), request = fetch } = {}) {
  if (env.SUPABASE_PROJECT_REF !== PROJECT || env.APPLE_CLIENT_ID !== CLIENT ||
      env.APPLE_KEY_ID !== KEY || !env.SUPABASE_AUTH_CONFIG_TOKEN?.startsWith('sbp_fc') || !env.RENEWAL_STATE) {
    throw new Error('Test renewal configuration is incomplete or outside its scope');
  }
  const api = async (method, body) => {
    const response = await request(`https://api.supabase.com/v1/projects/${PROJECT}/config/auth`, {
      method, headers: { Authorization: `Bearer ${env.SUPABASE_AUTH_CONFIG_TOKEN}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000), redirect: 'error',
    });
    if (!response.ok) {
      await response.body?.cancel();
      // Never log an upstream response, JWT, key, token or user data.
      throw new Error(`Test Auth configuration ${method} failed (${response.status})`);
    }
    if (method === 'PATCH') { await response.body?.cancel(); return; }
    return response.json();
  };
  const before = await api('GET');
  if (before.external_apple_enabled !== true || before.external_apple_client_id !== CLIENT) {
    throw new Error('Test Apple provider is disabled or its client changed');
  }
  let state = await env.RENEWAL_STATE.get(STATE_KEY, 'json');
  if (state?.current) {
    const claims = await validateCredential(state.current.jwt, env.APPLE_SIGNING_KEY);
    if (claims.exp !== state.current.expiresAt || (!state.pending && state.current.fingerprint !== before.external_apple_secret)) {
      throw new Error('Test Apple credential changed outside the renewal job; reconcile its private state');
    }
    if (!state.pending && claims.exp - now > 30 * DAY) {
      await env.RENEWAL_STATE.put(STATE_KEY, JSON.stringify({ ...state, checkedAt: now }));
      return { status: 'not-due', expiresAt: claims.exp, renewAfter: claims.exp - 30 * DAY };
    }
  }
  // Journal a candidate before PATCH. A timeout or KV failure can be recovered by
  // retrying exactly this credential, without restoring unrelated Auth settings.
  if (!state?.pending) {
    state = { ...state, pending: await createCredential(env.APPLE_SIGNING_KEY, now) };
    await env.RENEWAL_STATE.put(STATE_KEY, JSON.stringify(state));
  }
  const pendingClaims = await validateCredential(state.pending.jwt, env.APPLE_SIGNING_KEY);
  if (pendingClaims.exp < now + 30 * DAY) throw new Error('Pending credential is too old; reconcile private state');
  await api('PATCH', { external_apple_secret: state.pending.jwt });
  const after = await api('GET');
  if (safeSettings(before) !== safeSettings(after) || !after.external_apple_secret) {
    throw new Error('Test Auth settings changed during renewal; inspect before retrying');
  }
  state = { current: { ...state.pending, fingerprint: after.external_apple_secret }, renewedAt: now, checkedAt: now };
  await env.RENEWAL_STATE.put(STATE_KEY, JSON.stringify(state));
  return { status: 'renewed', expiresAt: pendingClaims.exp, renewAfter: pendingClaims.exp - 30 * DAY };
}

export default {
  // No public/manual HTTP trigger and no bindings on the customer-facing Worker.
  fetch() { return new Response('Not found', { status: 404 }); },
  async scheduled(_controller, env) {
    try {
      console.log(JSON.stringify({ job: 'test-apple-renewal', ...await renew(env) }));
    } catch {
      console.error(JSON.stringify({ job: 'test-apple-renewal', status: 'failed', retry: 'next hourly check' }));
      throw new Error('Test Apple renewal failed; inspect private configuration and token expiry');
    }
  },
};
