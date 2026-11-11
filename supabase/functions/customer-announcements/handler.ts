import { customerRuntime } from '../_shared/customer-runtime.ts';
type Identity = { user_id: string; session_id: string };
type Dependencies = Parameters<typeof customerRuntime>[0] & {
  identity: (token: string) => Promise<Identity | null>;
  rpc: (action: string, data: Record<string, unknown>) => Promise<unknown>;
};
export function createCustomerAnnouncementsHandler(deps: Dependencies) {
  const runtime = customerRuntime(deps);
  return async (req: Request) => {
    const allowed = await runtime.allows(req);
    const headers = {
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': allowed && req.headers.get('origin')
        ? req.headers.get('origin')!
        : deps.appUrl,
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
      const identity = token ? await deps.identity(token) : null;
      if (!identity) return reply(401, { error: 'AUTH_REQUIRED' });
      const reader = req.body?.getReader();
      if (!reader) return reply(400, { error: 'INVALID_REQUEST' });
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 2048) {
          await reader.cancel();
          return reply(413, { error: 'INVALID_REQUEST' });
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size);
      let pos = 0;
      for (const part of chunks) {
        bytes.set(part, pos);
        pos += part.length;
      }
      let body: Record<string, unknown>;
      try {
        body = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        return reply(400, { error: 'INVALID_REQUEST' });
      }
      if (
        !body || Array.isArray(body) ||
        !['status', 'register', 'preference'].includes(String(body.action))
      ) return reply(400, { error: 'INVALID_REQUEST' });
      const data: Record<string, unknown> = { ...identity };
      if (body.action !== 'status') {
        if (
          !/^[0-9a-f-]{36}$/i.test(String(body.deviceId)) ||
          !/^[0-9a-f]{64}$/.test(String(body.deviceSecret)) ||
          body.version !== 1
        ) return reply(400, { error: 'INVALID_REQUEST' });
        Object.assign(data, {
          deviceId: body.deviceId,
          deviceSecret: body.deviceSecret,
          version: 1,
        });
      }
      if (body.action === 'preference') {
        if (typeof body.enabled !== 'boolean') {
          return reply(400, { error: 'INVALID_REQUEST' });
        }
        data.enabled = body.enabled;
      }
      return reply(200, await deps.rpc(String(body.action), data));
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const name = ['AUTH_REQUIRED', 'FORBIDDEN', 'INVALID_REQUEST'].find((v) =>
        message.includes(v)
      );
      return reply(
        name === 'AUTH_REQUIRED'
          ? 401
          : name === 'FORBIDDEN'
          ? 403
          : name
          ? 400
          : 503,
        { error: name || 'UNAVAILABLE' },
      );
    }
  };
}
