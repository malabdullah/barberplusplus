type User = { id: string; email?: string; phone?: string; app_metadata?: Record<string, unknown> };
type Dependencies = {
  appUrl: string;
  authenticate: (authorization: string) => Promise<User | null>;
  list: (page: number) => Promise<{ users: User[]; hasMore: boolean }>;
  get: (id: string) => Promise<User | null>;
  allow: (adminId: string) => Promise<boolean>;
  audit: (adminId: string, targetId: string) => Promise<boolean>;
  update: (id: string, password: string) => Promise<boolean>;
  complete: (adminId: string, targetId: string) => Promise<boolean>;
};
const allowedRoles = new Set(['manager', 'barber', 'agent', 'customer']);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const role = (user: User) => typeof user.app_metadata?.role === 'string' ? user.app_metadata.role.toLowerCase() : '';
const passwordValid = (value: unknown): value is string => typeof value === 'string' && value.length >= 12 && new TextEncoder().encode(value).length <= 72 && /[A-Z]/.test(value) && /[a-z]/.test(value) && /[0-9]/.test(value) && /[!@#$%^&*(),.?":{}|<>]/.test(value);

export function createAdminPasswordResetHandler(deps: Dependencies) {
  return async (req: Request): Promise<Response> => {
    const headers = { 'Access-Control-Allow-Origin': deps.appUrl, 'Vary': 'Origin', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Cache-Control': 'no-store', 'Content-Type': 'application/json' };
    const reply = (status: number, body: object) => new Response(JSON.stringify(body), {status, headers});
    if (req.headers.get('origin') && req.headers.get('origin') !== deps.appUrl) return reply(403, {error:'Forbidden'});
    if (req.method === 'OPTIONS') return new Response(null, {status:204, headers});
    if (req.method !== 'POST') return reply(405, {error:'Method not allowed'});
    const authorization = req.headers.get('authorization');
    if (!authorization?.startsWith('Bearer ')) return reply(401, {error:'Unauthorized'});
    try {
      const caller = await deps.authenticate(authorization);
      if (!caller) return reply(401, {error:'Unauthorized'});
      if (role(caller) !== 'admin') return reply(403, {error:'Forbidden'});
      const reader = req.body?.getReader();
      if (!reader) return reply(400, {error:'Invalid request'});
      const chunks: Uint8Array[] = []; let size = 0;
      while (true) { const {done, value} = await reader.read(); if (done) break; size += value.length; if (size > 2048) { await reader.cancel(); return reply(413, {error:'Request too large'}); } chunks.push(value); }
      const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      let body: Record<string, unknown>; try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { return reply(400, {error:'Invalid request'}); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return reply(400, {error:'Invalid request'});
      if (body.action === 'list') {
        if (!Number.isSafeInteger(body.page) || Number(body.page) < 1 || Number(body.page) > 1000) return reply(400, {error:'Invalid page'});
        const result = await deps.list(Number(body.page));
        return reply(200, {users: result.users.filter(user => allowedRoles.has(role(user)) && (user.email || user.phone)).map(user => ({id:user.id,...(user.email ? {email:user.email} : {phone:user.phone}),role:role(user)})), hasMore:result.hasMore});
      }
      if (body.action !== 'reset' || typeof body.userId !== 'string' || !uuid.test(body.userId) || !passwordValid(body.password)) return reply(400, {error:'Invalid request'});
      if (body.userId === caller.id) return reply(403, {error:'Forbidden'});
      const target = await deps.get(body.userId);
      if (!target || !allowedRoles.has(role(target))) return reply(403, {error:'Forbidden'});
      if (!(await deps.allow(caller.id))) return reply(429, {error:'Reset temporarily unavailable'});
      if (!(await deps.audit(caller.id, target.id))) return reply(503, {error:'Reset unavailable'});
      if (!(await deps.update(target.id, body.password))) return reply(503, {error:'Reset unavailable'});
      let auditComplete = false;
      try { auditComplete = await deps.complete(caller.id, target.id); } catch { /* The password was already changed. */ }
      return reply(200, {success:true, auditComplete});
    } catch { return reply(503, {error:'Reset unavailable'}); }
  };
}
