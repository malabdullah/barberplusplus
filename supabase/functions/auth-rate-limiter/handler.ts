type Parameters = {
  p_identifier: string;
  p_max_attempts: number;
  p_window_seconds: number;
  p_lockout_seconds: number;
};

type Dependencies = {
  appUrl: string;
  checkLimit: (parameters: Parameters) => Promise<{ data: unknown; error: unknown }>;
};

const rateLimits = {
  login: { maxAttempts: 5, windowSeconds: 60, lockoutSeconds: 300 },
  signup: { maxAttempts: 3, windowSeconds: 3600, lockoutSeconds: 3600 },
  passwordReset: { maxAttempts: 3, windowSeconds: 3600, lockoutSeconds: 3600 },
};

export function createAuthRateLimiterHandler({ appUrl, checkLimit }: Dependencies) {
  const headers = {
    'Access-Control-Allow-Origin': appUrl,
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json',
  };
  const unavailable = () => new Response(JSON.stringify({
    error: 'Rate limit unavailable', allowed: false, retryAfter: 60, remaining: 0,
  }), { status: 503, headers: { ...headers, 'Retry-After': '60' } });

  return async (req: Request): Promise<Response> => {
    const origin = req.headers.get('Origin');
    if (origin && origin !== appUrl) {
      return new Response(JSON.stringify({ error: 'Origin not allowed' }), { status: 403, headers });
    }
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
    }

    const maxBodyBytes = 4096;
    const declaredLength = req.headers.get('Content-Length');
    if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > maxBodyBytes) {
      void req.body?.cancel().catch(() => {});
      return new Response(JSON.stringify({ error: 'Request too large' }), { status: 413, headers });
    }
    let body: unknown;
    const reader = req.body?.getReader();
    try {
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (reader) while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBodyBytes) {
          void reader.cancel().catch(() => {});
          return new Response(JSON.stringify({ error: 'Request too large' }), { status: 413, headers });
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid request' }), { status: 400, headers });
    } finally {
      reader?.releaseLock();
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return new Response(JSON.stringify({ error: 'Invalid request' }), { status: 400, headers });
    }
    const { action, identifier } = body as Record<string, unknown>;
    if (typeof action !== 'string' || !Object.hasOwn(rateLimits, action)
      || typeof identifier !== 'string' || !identifier.trim() || identifier.length > 320
      || [...identifier].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
      return new Response(JSON.stringify({ error: 'Invalid request' }), { status: 400, headers });
    }
    const config = rateLimits[action as keyof typeof rateLimits];
    try {
      const result = await checkLimit({
        p_identifier: `${action}:${identifier.trim().toLowerCase()}`,
        p_max_attempts: config.maxAttempts,
        p_window_seconds: config.windowSeconds,
        p_lockout_seconds: config.lockoutSeconds,
      });
      if (result.error || !result.data || typeof result.data !== 'object') return unavailable();
      const data = result.data as Record<string, unknown>;
      if (typeof data.allowed !== 'boolean' || !Number.isSafeInteger(data.retryAfter)
        || Number(data.retryAfter) < 0 || !Number.isSafeInteger(data.remaining)
        || Number(data.remaining) < 0) return unavailable();
      return new Response(JSON.stringify({ allowed: data.allowed, retryAfter: data.retryAfter,
        remaining: data.remaining }), { status: 200, headers });
    } catch {
      // Never expose caller identifiers, backend errors, credentials or an
      // invented allowance. The optional feature remains unavailable if broken.
      return unavailable();
    }
  };
}
