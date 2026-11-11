import { customerRuntime } from '../_shared/customer-runtime.ts';
type Data = Record<string, unknown>;
type Identity = {
  user_id: string;
  session_id: string;
  role: string;
  aal: string;
};
type Dependencies = Parameters<typeof customerRuntime>[0] & {
  authenticate: (token: string) => Promise<Identity | null>;
  rpc: (action: string, data: Data) => Promise<unknown>;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function createAdminPushHandler(deps: Dependencies) {
  const runtime = customerRuntime(deps);
  return async (req: Request) => {
    const allowed = await runtime.allows(req);
    const origin = req.headers.get('origin');
    const headers = {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': allowed && origin ? origin : deps.appUrl,
      'Access-Control-Allow-Headers':
        'authorization, apikey, content-type, x-client-info',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Vary': 'Origin',
    };
    const reply = (status: number, value: unknown) =>
      Response.json(value, { status, headers });
    if (!runtime.enabled) return reply(404, { error: 'NOT_AVAILABLE' });
    if (!allowed) return reply(403, { error: 'FORBIDDEN' });
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }
    if (req.method !== 'POST') return reply(405, { error: 'INVALID_REQUEST' });
    try {
      const token =
        req.headers.get('authorization')?.replace(/^Bearer /i, '') || '';
      const identity = token ? await deps.authenticate(token) : null;
      if (!identity) return reply(401, { error: 'AUTH_REQUIRED' });
      if (identity.role !== 'admin') return reply(403, { error: 'FORBIDDEN' });
      if (identity.aal !== 'aal2') {
        return reply(403, { error: 'ADMIN_MFA_REQUIRED' });
      }
      const reader = req.body?.getReader();
      if (!reader) return reply(400, { error: 'INVALID_REQUEST' });
      const parts: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 65536) {
          await reader.cancel();
          return reply(413, { error: 'INVALID_REQUEST' });
        }
        parts.push(value);
      }
      const bytes = new Uint8Array(size);
      let at = 0;
      for (const p of parts) {
        bytes.set(p, at);
        at += p.length;
      }
      let body: Data;
      try {
        body = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        return reply(400, { error: 'INVALID_REQUEST' });
      }
      if (
        !body || Array.isArray(body) ||
        ![
          'options',
          'users',
          'preview',
          'send',
          'history',
          'details',
          'recipients',
        ].includes(String(body.action))
      ) return reply(400, { error: 'INVALID_REQUEST' });
      const action = String(body.action);
      const data: Data = {
        user_id: identity.user_id,
        session_id: identity.session_id,
      };
      if (body.page !== undefined) {
        if (
          !Number.isInteger(body.page) || Number(body.page) < 1 ||
          Number(body.page) > 10000
        ) return reply(400, { error: 'INVALID_REQUEST' });
        data.page = body.page;
      }
      if (action === 'options' && body.query !== undefined) {
        if (typeof body.query !== 'string' || body.query.length > 120) {
          return reply(400, { error: 'INVALID_REQUEST' });
        }
        data.query = body.query;
      }
      if (['send', 'details', 'recipients'].includes(action)) {
        if (!uuid.test(String(body.campaignId))) {
          return reply(400, { error: 'INVALID_REQUEST' });
        }
        data.campaignId = body.campaignId;
      }
      if (['users', 'preview'].includes(action)) {
        if (
          !body.filters || typeof body.filters !== 'object' ||
          Array.isArray(body.filters)
        ) return reply(400, { error: 'INVALID_REQUEST' });
        data.filters = body.filters;
      }
      if (action === 'preview') {
        for (
          const field of [
            'titleEn',
            'bodyEn',
            'titleAr',
            'bodyAr',
            'destination',
          ]
        ) {
          if (
            body[field] !== undefined && typeof body[field] !== 'string'
          ) return reply(400, { error: 'INVALID_REQUEST' });
          data[field] = body[field];
        }
      }
      if (action === 'send') data.confirmed = body.confirmed === true;
      return reply(200, await deps.rpc(action, data));
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const name = [
        'AUTH_REQUIRED',
        'ADMIN_MFA_REQUIRED',
        'FORBIDDEN',
        'INVALID_REQUEST',
        'DELIVERY_DISABLED',
        'RATE_LIMITED',
        'AUDIENCE_TOO_LARGE',
        'NO_RECIPIENTS',
        'CONFIRMATION_REQUIRED',
        'PREVIEW_EXPIRED',
        'NOT_FOUND',
      ].find((code) => message.includes(code));
      return reply(
        name === 'AUTH_REQUIRED'
          ? 401
          : ['ADMIN_MFA_REQUIRED', 'FORBIDDEN'].includes(name || '')
          ? 403
          : name === 'NOT_FOUND'
          ? 404
          : name === 'RATE_LIMITED'
          ? 429
          : name
          ? 400
          : 503,
        { error: name || 'UNAVAILABLE' },
      );
    }
  };
}
