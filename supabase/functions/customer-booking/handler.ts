type Body = Record<string, unknown>;
type Dependencies = {
  environment: string;
  appUrl: string;
  publicUrl: string;
  secret: string;
  catalog: () => Promise<unknown>;
  customer?: (token: string) => Promise<{id: string; session_id: string; name: string; phone: string; countryCode: string} | null>;
  booking: (action: string, data: Body) => Promise<unknown>;
};
type Proof = { purpose: string; id: string; name: string; phone: string; country_code: string; expires: number; user_id?: string; session_id?: string; code?: string };
const encoder = new TextEncoder();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const patterns: Record<string, RegExp> = { '+965': /^[569]\d{7}$/, '+966': /^5\d{8}$/, '+971': /^5\d{8}$/, '+973': /^\d{8}$/, '+974': /^[3567]\d{7}$/, '+968': /^[79]\d{7}$/ };
const local = (value: string) => {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && !url.username && !url.password; } catch { return false; }
};
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
const decode = (value: string) => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));

export function createCustomerBookingHandler(deps: Dependencies) {
  const enabled = ['development', 'test'].includes(deps.environment) && local(deps.appUrl) && local(deps.publicUrl) && deps.secret.length >= 32;
  const key = enabled ? crypto.subtle.importKey('raw', encoder.encode(`customer-booking-test-v1:${deps.secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']) : null;
  const sign = async (proof: Proof) => {
    const payload = encode(encoder.encode(JSON.stringify(proof)));
    const signature = await crypto.subtle.sign('HMAC', await key!, encoder.encode(payload));
    return `${payload}.${encode(new Uint8Array(signature))}`;
  };
  const verify = async (token: unknown, purpose: string): Promise<Proof | null> => {
    if (typeof token !== 'string' || token.length > 3000) return null;
    try {
      const [payload, signature, extra] = token.split('.');
      if (extra || !payload || !signature || !await crypto.subtle.verify('HMAC', await key!, decode(signature), encoder.encode(payload))) return null;
      const proof = JSON.parse(new TextDecoder().decode(decode(payload))) as Proof;
      return proof.purpose === purpose && proof.expires > Date.now() && uuid.test(proof.id) ? proof : null;
    } catch { return null; }
  };
  return async (req: Request): Promise<Response> => {
    const origin = req.headers.get('origin');
    // Accept only the two aliases for this local Test frontend, with the same port.
    const originAllowed = enabled && (!origin || (local(origin) && new URL(origin).port === new URL(deps.appUrl).port));
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Vary': 'Origin', 'Access-Control-Allow-Origin': originAllowed && origin ? origin : deps.appUrl, 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
    const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });
    if (!enabled) return reply(404, { error: 'NOT_AVAILABLE' });
    if (!originAllowed) return reply(403, { error: 'FORBIDDEN' });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (req.method !== 'POST') return reply(405, { error: 'INVALID_REQUEST' });
    try {
      const reader = req.body?.getReader();
      if (!reader) return reply(400, { error: 'INVALID_REQUEST' });
      const chunks: Uint8Array[] = []; let size = 0;
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        size += value.length; if (size > 8192) { await reader.cancel(); return reply(413, { error: 'INVALID_REQUEST' }); }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      let body: Body;
      try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { return reply(400, { error: 'INVALID_REQUEST' }); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return reply(400, { error: 'INVALID_REQUEST' });
      if (body.action === 'account-proof') {
        const token = req.headers.get('authorization')?.replace(/^Bearer /i, '') || '';
        const account = token && deps.customer ? await deps.customer(token) : null;
        if (!account) return reply(401, {error:'VERIFICATION_REQUIRED'});
        return reply(200, {verification: await sign({purpose:'verified',id:crypto.randomUUID(),user_id:account.id,session_id:account.session_id,name:account.name,phone:account.phone,country_code:account.countryCode,expires:Date.now()+10*60_000})});
      }
      if (body.action === 'catalog') return reply(200, await deps.catalog());
      if (body.action === 'request-code') {
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        const phone = typeof body.phone === 'string' ? body.phone.replace(/[\s()-]/g, '') : '';
        const countryCode = typeof body.countryCode === 'string' ? body.countryCode : '';
        if (name.length < 2 || name.length > 120 || !patterns[countryCode]?.test(phone)) return reply(400, { error: 'INVALID_DETAILS' });
        const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 900000 + 100000);
        const proof: Proof = { purpose: 'challenge', id: crypto.randomUUID(), name, phone, country_code: countryCode, expires: Date.now() + 5 * 60_000, code };
        // Intentionally displayed only in loopback Test. No messaging provider runs.
        return reply(200, { challenge: await sign(proof), testCode: code, expiresIn: 300 });
      }
      if (body.action === 'verify-code') {
        const proof = await verify(body.challenge, 'challenge');
        if (!proof || body.code !== proof.code) return reply(400, { error: 'INVALID_CODE' });
        delete proof.code;
        return reply(200, { verification: await sign({ ...proof, purpose: 'verified', expires: Date.now() + 10 * 60_000 }) });
      }
      if (!['slots', 'book'].includes(String(body.action)) || !uuid.test(String(body.branchId)) || !uuid.test(String(body.barberId))
        || !Array.isArray(body.serviceIds) || body.serviceIds.length < 1 || body.serviceIds.length > 10
        || body.serviceIds.some(id => typeof id !== 'string' || !uuid.test(id))
        || typeof body.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) return reply(400, { error: 'INVALID_SELECTION' });
      const data: Body = { branch_id: body.branchId, barber_id: body.barberId, service_ids: body.serviceIds, date: body.date };
      if (body.action === 'book') {
        const proof = await verify(body.verification, 'verified');
        if (!proof) return reply(401, { error: 'VERIFICATION_REQUIRED' });
        if (proof.user_id) {
          const token = req.headers.get('authorization')?.replace(/^Bearer /i, '') || '';
          const account = token && deps.customer ? await deps.customer(token) : null;
          if (!account || account.id !== proof.user_id || account.session_id !== proof.session_id) return reply(401, {error:'VERIFICATION_REQUIRED'});
        }
        if (typeof body.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(body.time)
          || (body.notes !== undefined && (typeof body.notes !== 'string' || body.notes.length > 500))) return reply(400, { error: 'INVALID_REQUEST' });
        Object.assign(data, { id: proof.id, name: proof.name, phone: proof.phone, country_code: proof.country_code, time: body.time, notes: body.notes || '' });
      }
      let result;
      try { result = await deps.booking(String(body.action), data); }
      catch (failure) {
        // These SQLSTATEs guarantee transaction rollback. Retry the entire RPC
        // once with the same signed booking ID; other errors remain unchanged.
        // https://www.postgresql.org/docs/16/mvcc-serialization-failure-handling.html
        if (body.action !== 'book' || !(failure instanceof Error) || !/^(40P01|40001)\b/.test(failure.message)) throw failure;
        result = await deps.booking('book', data);
      }
      return reply(200, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (/SLOT_UNAVAILABLE|overlapping|Booking conflict|23P01/.test(message)) return reply(409, { error: 'SLOT_UNAVAILABLE' });
      if (/INVALID_(SELECTION|DATE|REQUEST)|BOOKING_UNAVAILABLE/.test(message)) return reply(400, { error: message.match(/INVALID_(SELECTION|DATE|REQUEST)|BOOKING_UNAVAILABLE/)![0] });
      return reply(503, { error: 'UNAVAILABLE' });
    }
  };
}
