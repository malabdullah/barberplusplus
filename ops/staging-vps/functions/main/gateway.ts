import { createLocalJWKSet, decodeProtectedHeader, jwtVerify, type JSONWebKeySet } from 'npm:jose@6.2.10';

// This is the self-hosted equivalent of config.toml's per-function policy.
// No environment flag can globally disable authentication. New functions are
// denied until explicitly reviewed and added here.
export const functionPolicies = {
  'auth-rate-limiter': 'jwt',
  'get-kuwait-governorates': 'jwt',
  'invite-barber': 'jwt',
  'send-whatsapp-message': 'jwt',
  'send-booking-reminders': 'cron',
  'cleanup-notifications': 'cron',
  'whatsapp-webhook': 'meta-webhook',
  'whatsapp-flow-endpoint': 'meta-flow',
} as const;

type Settings = {
  jwtSecret?: string;
  jwks?: string;
  cronSecret?: string;
  metaAppSecret?: string;
  metaVerifyToken?: string;
};
type Dispatch = (name: string, request: Request) => Promise<Response>;
const encoder = new TextEncoder();
const appOrigin = 'https://staging-barber.malabdullah.cloud';
const maxMetaBytes = 100 * 1024;

async function equalSecret(expected: string | undefined, supplied: string | null) {
  if (!expected || !supplied) return false;
  const hashes = await Promise.all([expected, supplied].map((value) => crypto.subtle.digest('SHA-256', encoder.encode(value))));
  const left = new Uint8Array(hashes[0]);
  const right = new Uint8Array(hashes[1]);
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  return diff === 0;
}

export function createGateway(settings: Settings, dispatch: Dispatch) {
  // Bad configured JWKS is a startup error, never a reason to skip verification.
  const jwks = settings.jwks ? createLocalJWKSet(JSON.parse(settings.jwks) as JSONWebKeySet) : undefined;
  const reply = (status: number, message: string) => new Response(JSON.stringify({ message }), {
    status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': appOrigin, Vary: 'Origin' },
  });
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    // Envoy strips /functions/v1/ before forwarding. Only one exact segment is
    // accepted: no suffixes, child routes, encoded aliases, or filesystem paths.
    const name = url.pathname.slice(1);
    if (!Object.hasOwn(functionPolicies, name)) return reply(404, 'Unknown function');
    const policy = functionPolicies[name as keyof typeof functionPolicies];
    if (request.method === 'OPTIONS') {
      if (request.headers.get('origin') !== appOrigin) return reply(403, 'Origin not allowed');
      return new Response(null, { status: 204, headers: {
        'Access-Control-Allow-Origin': appOrigin, Vary: 'Origin',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
      } });
    }
    try {
      if (policy === 'jwt') {
        const token = request.headers.get('authorization')?.match(/^Bearer ([^\s]+)$/i)?.[1];
        if (!token) return reply(401, 'Unauthorized');
        const { alg } = decodeProtectedHeader(token);
        const options = { requiredClaims: ['exp', 'role'], algorithms: [alg || ''] };
        if (alg === 'HS256' && settings.jwtSecret && settings.jwtSecret.length >= 32) {
          await jwtVerify(token, encoder.encode(settings.jwtSecret), options);
        } else if ((alg === 'ES256' || alg === 'RS256') && jwks) {
          await jwtVerify(token, jwks, options);
        } else return reply(401, 'Unauthorized');
      } else if (policy === 'cron') {
        if (request.method !== 'POST') return reply(405, 'Method not allowed');
        if (!await equalSecret(settings.cronSecret, request.headers.get('x-cron-secret'))) return reply(401, 'Unauthorized');
      } else if (policy === 'meta-webhook' && request.method === 'GET') {
        if (url.searchParams.get('hub.mode') !== 'subscribe'
          || !await equalSecret(settings.metaVerifyToken, url.searchParams.get('hub.verify_token'))) return reply(403, 'Verification failed');
      } else {
        if (request.method !== 'POST') return reply(405, 'Method not allowed');
        const signature = request.headers.get('x-hub-signature-256');
        if (!settings.metaAppSecret || !signature?.match(/^sha256=[a-fA-F0-9]{64}$/)) return reply(401, 'Unauthorized');
        if (Number(request.headers.get('content-length')) > maxMetaBytes) return reply(413, 'Request too large');
        // Bound the stream itself; Content-Length is not trustworthy.
        const reader = request.body?.getReader();
        if (!reader) return reply(400, 'Missing body');
        const chunks: Uint8Array[] = [];
        let length = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.length;
          if (length > maxMetaBytes) { await reader.cancel(); return reply(413, 'Request too large'); }
          chunks.push(value);
        }
        const body = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
        const key = await crypto.subtle.importKey('raw', encoder.encode(settings.metaAppSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
        const bytes = Uint8Array.from(signature.slice(7).match(/../g)!, (hex) => parseInt(hex, 16));
        if (!await crypto.subtle.verify('HMAC', key, bytes, body)) return reply(401, 'Unauthorized');
        request = new Request(request.url, { method: request.method, headers: request.headers, body });
      }
    } catch {
      // Never log tokens, signatures, secrets, or parser exception details.
      return reply(401, 'Unauthorized');
    }
    try { return await dispatch(name, request); }
    catch { return reply(500, 'Function unavailable'); }
  };
}
