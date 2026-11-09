import { customerRuntime } from '../_shared/customer-runtime.ts';
import type { GooglePhoneConfig } from './google-phone.ts';
type Body = Record<string, unknown>;
type Dependencies = {
  environment: string;
  productionEnabled?: boolean;
  cloudTestProjectRef?: string;
  cloudAccessKey?: string;
  appUrl: string;
  publicUrl: string;
  secret: string;
  catalog: () => Promise<unknown>;
  packages?: (shop: string, barber: string, date: string | null) => Promise<unknown>;
  discovery?: (action: string, data: Body) => Promise<unknown>;
  statistics?: () => Promise<{ shops: number; monthlyBookings: number; barbers: number }>;
  customer?: (token: string) => Promise<{id: string; customerId?: string; session_id: string; name: string; phone: string; countryCode: string} | null>;
  phone?: GooglePhoneConfig;
  startTestPhone?: (phone: string) => Promise<string>;
  confirmPhone?: (session: string, code: string, phone: string) => Promise<boolean>;
  accountPhone?: (customerId: string, country: string, phone: string, verified: boolean) => Promise<boolean>;
  claim?: (data: Body) => Promise<unknown>;
  close?: (id: string) => Promise<{ found: boolean; closed: boolean }>;
  recover?: (proof: Proof) => Promise<Record<string, unknown> | null>;
  booking: (action: string, data: Body) => Promise<unknown>;
};
type Proof = { purpose: string; id: string; name: string; phone: string; country_code: string; expires: number; user_id?: string; session_id?: string; code?: string; phone_verified?: boolean };
const encoder = new TextEncoder();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const patterns: Record<string, RegExp> = { '+965': /^[569]\d{7}$/, '+966': /^5\d{8}$/, '+971': /^5\d{8}$/, '+973': /^\d{8}$/, '+974': /^[3567]\d{7}$/, '+968': /^[79]\d{7}$/ };
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
const decode = (value: string) => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));

export function createCustomerBookingHandler(deps: Dependencies) {
  const runtime = customerRuntime(deps);
  const enabled = runtime.enabled;
  const key = enabled ? crypto.subtle.importKey('raw', encoder.encode(`customer-booking-test-v1:${deps.secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']) : null;
  // Reusing a Google challenge can only retry the same booking ID, even
  // if the provider accepts a second confirmation of that challenge.
  const challengeBookingId = async (session: string) => {
    const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', await key!, encoder.encode('phone-checkout:' + session)));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes.slice(0, 16), byte => byte.toString(16).padStart(2, '0')).join('');
    return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
  };
  const sign = async (proof: Proof) => {
    const payload = encode(encoder.encode(JSON.stringify(proof)));
    const signature = await crypto.subtle.sign('HMAC', await key!, encoder.encode(payload));
    return `${payload}.${encode(new Uint8Array(signature))}`;
  };
  const verify = async (token: unknown, purpose: string, recoveryWindow = 0): Promise<Proof | null> => {
    if (typeof token !== 'string' || token.length > 3000) return null;
    try {
      const [payload, signature, extra] = token.split('.');
      if (extra || !payload || !signature || !await crypto.subtle.verify('HMAC', await key!, decode(signature), encoder.encode(payload))) return null;
      const proof = JSON.parse(new TextDecoder().decode(decode(payload))) as Proof;
      return proof.purpose === purpose && Number.isFinite(proof.expires) && proof.expires + recoveryWindow > Date.now() && uuid.test(proof.id) ? proof : null;
    } catch { return null; }
  };
  return async (req: Request): Promise<Response> => {
    const origin = req.headers.get('origin');
    // The authenticated Test Worker sets this header itself; direct native Test
    // traffic and environments without explicit phone settings stay compatible.
    const phoneConfig = deps.environment === 'cloud-test' && req.headers.get('x-barber-test-web') !== '1' ? undefined : deps.phone;
    const originAllowed = await runtime.allows(req);
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
      if (['recover-booking', 'resolve-booking'].includes(String(body.action))) {
        if (body.action === 'recover-booking' && !deps.recover || body.action === 'resolve-booking' && !deps.close) return reply(404, { error: 'NOT_AVAILABLE' });
        const proof = await verify(body.verification, 'verified', 24 * 60 * 60_000);
        if (!proof) return reply(403, { error: 'RECOVERY_UNAVAILABLE' });
        if (proof.user_id) {
          const token = req.headers.get('authorization')?.replace(/^Bearer /i, '') || '';
          const account = token && deps.customer ? await deps.customer(token) : null;
          if (!account || account.id !== proof.user_id) return reply(401, { error: 'VERIFICATION_REQUIRED' });
        }
        if (body.action === 'resolve-booking') {
          if (!deps.close) throw Error('Resolution unavailable');
          const result = await deps.close(proof.id);
          if (!result.found && result.closed) return reply(200, result);
          if (!result.found) throw Error('Resolution unavailable');
        }
        if (!deps.recover) throw Error('Recovery unavailable');
        const receipt = await deps.recover(proof);
        if (!receipt) return reply(200, { found: false });
        const expires = Date.parse(String(receipt.created_at)) + 60 * 60_000;
        const claimToken = !proof.user_id && expires > Date.now()
          ? await sign({ ...proof, purpose: 'receipt', expires }) : undefined;
        const { created_at: _createdAt, ...publicReceipt } = receipt;
        return reply(200, { found: true, receipt: { ...publicReceipt, ...(claimToken ? { claimToken } : {}) } });
      }
      const token = req.headers.get('authorization')?.replace(/^Bearer /i, '') || '';
      const readAccount = () => token && deps.customer ? deps.customer(token) : null;
      const isAccountPhoneVerified = async (account: NonNullable<Awaited<ReturnType<typeof readAccount>>>) =>
        Boolean(account.customerId && await deps.accountPhone?.(account.customerId, account.countryCode, account.phone, false));
      if (body.action === 'packages') {
        if (!uuid.test(String(body.branchId)) || !uuid.test(String(body.barberId)) || (body.date != null && (typeof body.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)))) return reply(400, { error: 'INVALID_SELECTION' });
        if (!deps.packages) return reply(503, { error: 'UNAVAILABLE' });
        return reply(200, { packages: await deps.packages(String(body.branchId), String(body.barberId), typeof body.date === 'string' ? body.date : null) });
      }
      if (body.action === 'phone-config') {
        const config = phoneConfig?.testPhones
          ? { projectId: phoneConfig.projectId, testPhones: phoneConfig.testPhones }
          : phoneConfig;
        return reply(200, { phone: config || null });
      }
      if (body.action === 'phone-start') {
        if (deps.environment !== 'cloud-test' || !phoneConfig?.testPhones || !deps.startTestPhone) {
          return reply(404, { error: 'NOT_AVAILABLE' });
        }
        const number = typeof body.phone === 'string' ? body.phone : '';
        if (!phoneConfig.testPhones.includes(number)) return reply(400, { error: 'PHONE_TEST_NUMBER' });
        return reply(200, { session: await deps.startTestPhone(number) });
      }
      if (body.action === 'phone-confirm') {
        if (!phoneConfig || !deps.confirmPhone) return reply(404, { error: 'NOT_AVAILABLE' });
        const account = await readAccount();
        if (token && !account) return reply(401, { error: 'VERIFICATION_REQUIRED' });
        const name = account?.name || (typeof body.name === 'string' ? body.name.trim() : '');
        const phone = typeof body.phone === 'string' ? body.phone.replace(/[\s()-]/g, '') : '';
        const country = typeof body.countryCode === 'string' ? body.countryCode : '';
        if (name.length < 2 || name.length > 120 || !patterns[country]?.test(phone)) return reply(400, { error: 'INVALID_DETAILS' });
        if (account?.phone && (account.phone !== phone || account.countryCode !== country)) return reply(409, { error: 'PHONE_CHANGED' });
        if (typeof body.session !== 'string' || body.session.length < 1 || body.session.length > 4096
            || typeof body.code !== 'string' || !/^\d{6}$/.test(body.code)) return reply(400, { error: 'INVALID_CODE' });
        if (!await deps.confirmPhone(body.session, body.code, country + phone)) return reply(400, { error: 'INVALID_CODE' });
        if (account && (!account.customerId || !await deps.accountPhone?.(account.customerId, country, phone, true))) {
          return reply(409, { error: 'PHONE_CHANGED' });
        }
        return reply(200, { verification: await sign({
          purpose: 'verified', id: await challengeBookingId(body.session), name, phone, country_code: country,
          phone_verified: true, expires: Date.now() + 10 * 60_000,
          ...(account ? { user_id: account.id, session_id: account.session_id } : {}),
        }) });
      }
      if (body.action === 'claim-booking') {
        const proof = await verify(body.claimToken, 'receipt');
        if (!proof || proof.user_id) return reply(403, { error: 'CLAIM_UNAVAILABLE' });
        const account = await readAccount();
        if (!account) return reply(401, { error: 'VERIFICATION_REQUIRED' });
        if (account.phone !== proof.phone || account.countryCode !== proof.country_code) return reply(403, { error: 'CLAIM_UNAVAILABLE' });
        if (phoneConfig && (!proof.phone_verified || !account.customerId)) return reply(403, { error: 'CLAIM_UNAVAILABLE' });
        if (!deps.claim) throw Error('Claim unavailable');
        try { await deps.claim({ booking_id: proof.id, account_user_id: account.id, session_id: account.session_id }); }
        catch (error) {
          if (error instanceof Error && /INVALID_REQUEST|AUTH_REQUIRED/.test(error.message)) return reply(403, { error: 'CLAIM_UNAVAILABLE' });
          throw error;
        }
        // A signed receipt from this checkout already proves phone possession.
        if (phoneConfig && account.customerId) await deps.accountPhone?.(account.customerId, proof.country_code, proof.phone, true);
        return reply(200, { saved: true });
      }
      if (body.action === 'account-proof') {
        const account = await readAccount();
        if (!account) return reply(401, {error:'VERIFICATION_REQUIRED'});
        if (phoneConfig && (!account.phone || !await isAccountPhoneVerified(account))) return reply(428, { error: 'PHONE_VERIFICATION_REQUIRED' });
        if (!account.phone || !patterns[account.countryCode]?.test(account.phone)) return reply(400, {error:'INVALID_DETAILS'});
        return reply(200, {verification: await sign({purpose:'verified',id:crypto.randomUUID(),user_id:account.id,session_id:account.session_id,phone_verified:Boolean(phoneConfig),name:account.name,phone:account.phone,country_code:account.countryCode,expires:Date.now()+10*60_000})});
      }
      if (['discovery-filters', 'discovery-search', 'discovery-selection'].includes(String(body.action))) {
        if (!deps.discovery) return reply(503, { error: 'UNAVAILABLE' });
        const action = String(body.action).slice('discovery-'.length);
        const mode = body.mode ?? 'shop';
        const clock = /^([01]\d|2[0-3]):[0-5]\d$/;
        if (!['shop', 'barber', 'time'].includes(String(mode))
          || ['city', 'query'].some(field => body[field] !== undefined && (typeof body[field] !== 'string' || String(body[field]).length > 120))
          || ['branchId', 'barberId'].some(field => body[field] !== undefined && body[field] !== '' && !uuid.test(String(body[field])))
          || (action === 'selection' && !uuid.test(String(body.barberId)))
          || (mode === 'time' && (typeof body.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)
            || !clock.test(String(body.rangeStart)) || !clock.test(String(body.rangeEnd)) || String(body.rangeStart) > String(body.rangeEnd)))
          || (body.cursor !== undefined && body.cursor !== null && (typeof body.cursor !== 'object' || Array.isArray(body.cursor) || JSON.stringify(body.cursor).length > 1000))) {
          return reply(400, { error: 'INVALID_REQUEST' });
        }
        const account = await readAccount();
        if (token && !account) return reply(401, { error: 'VERIFICATION_REQUIRED' });
        return reply(200, await deps.discovery(action, {
          mode, city: body.city, query: body.query, branch_id: body.branchId, barber_id: body.barberId,
          date: body.date, range_start: body.rangeStart, range_end: body.rangeEnd, cursor: body.cursor,
          ...(account ? { account_user_id: account.id, session_id: account.session_id } : {}),
        }));
      }
      if (body.action === 'catalog') return reply(200, await deps.catalog());
      if (body.action === 'statistics') {
        if (!deps.statistics) return reply(503, { error: 'UNAVAILABLE' });
        const totals = await deps.statistics();
        const counts = { shops: totals.shops, monthlyBookings: totals.monthlyBookings, barbers: totals.barbers };
        if (Object.values(counts).some(value => !Number.isSafeInteger(value) || value < 0)) throw Error('Invalid statistics');
        return reply(200, counts);
      }
      if (body.action === 'guest-proof') {
        if (phoneConfig) return reply(428, { error: 'PHONE_VERIFICATION_REQUIRED' });
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        const phone = typeof body.phone === 'string' ? body.phone.replace(/[\s()-]/g, '') : '';
        const countryCode = typeof body.countryCode === 'string' ? body.countryCode : '';
        if (name.length < 2 || name.length > 120 || !patterns[countryCode]?.test(phone)) return reply(400, { error: 'INVALID_DETAILS' });
        return reply(200, { verification: await sign({ purpose: 'verified', id: crypto.randomUUID(), name, phone, country_code: countryCode, expires: Date.now()+10*60_000 }) });
      }
      if (body.action === 'request-code') {
        if (!runtime.localTest) return reply(404, { error: 'NOT_AVAILABLE' });
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
        if (!runtime.localTest) return reply(404, { error: 'NOT_AVAILABLE' });
        const proof = await verify(body.challenge, 'challenge');
        if (!proof || body.code !== proof.code) return reply(400, { error: 'INVALID_CODE' });
        delete proof.code;
        return reply(200, { verification: await sign({ ...proof, purpose: 'verified', expires: Date.now() + 10 * 60_000 }) });
      }
      if (!['slots', 'book'].includes(String(body.action)) || !uuid.test(String(body.branchId)) || !uuid.test(String(body.barberId))
        || !Array.isArray(body.serviceIds) || body.serviceIds.length < 1 || body.serviceIds.length > 10
        || body.serviceIds.some(id => typeof id !== 'string' || !uuid.test(id))
        || typeof body.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) return reply(400, { error: 'INVALID_SELECTION' });
      if (body.packageOfferId != null && body.packageOfferId !== '' && !uuid.test(String(body.packageOfferId))) return reply(400, { error: 'INVALID_PACKAGE_SELECTION' });
      const data: Body = { branch_id: body.branchId, barber_id: body.barberId, service_ids: body.serviceIds, date: body.date,
        ...(body.packageOfferId ? { package_offer_id: body.packageOfferId } : {}) };
      if (body.action === 'book' && ('expectedPrice' in body || 'expectedDuration' in body)) {
        if (typeof body.expectedPrice !== 'string' || !/^\d{1,8}(\.\d{1,3})?$/.test(body.expectedPrice)
          || typeof body.expectedDuration !== 'string' || !/^\d{1,3}$/.test(body.expectedDuration)) return reply(400, { error: 'INVALID_REQUEST' });
        data.expected_price = body.expectedPrice; data.expected_duration = body.expectedDuration;
      }
      if (body.action === 'book') {
        if (body.packageOfferId) {
          const quote = body.packageQuote as Body | undefined;
          if (!quote || typeof quote.price !== 'number' || !Number.isFinite(quote.price) || quote.price <= 0 || typeof quote.duration !== 'number' || !Number.isInteger(quote.duration) || quote.duration < 5 || quote.duration > 480) return reply(400, { error: 'PACKAGE_CHANGED' });
          data.package_quote = { price: quote.price, duration: quote.duration };
        }
        const proof = await verify(body.verification, 'verified');
        if (!proof) return reply(401, { error: 'VERIFICATION_REQUIRED' });
        if (phoneConfig && !proof.phone_verified) return reply(428, { error: 'PHONE_VERIFICATION_REQUIRED' });
        if (proof.user_id) {
          const account = await readAccount();
          if (!account || account.id !== proof.user_id || account.session_id !== proof.session_id) return reply(401, {error:'VERIFICATION_REQUIRED'});
          if (phoneConfig && (account.phone !== proof.phone || account.countryCode !== proof.country_code || !await isAccountPhoneVerified(account))) {
            return reply(428, { error: 'PHONE_VERIFICATION_REQUIRED' });
          }
        }
        if (typeof body.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(body.time)
          || (body.notes !== undefined && (typeof body.notes !== 'string' || body.notes.length > 500))) return reply(400, { error: 'INVALID_REQUEST' });
        if (body.bookingPolicy !== undefined) {
          const policy = body.bookingPolicy as Body | null;
          const validMinutes = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 525600;
          if (!policy || !validMinutes(policy.cancel_minutes) || !validMinutes(policy.reschedule_minutes)) return reply(400, { error: 'INVALID_REQUEST' });
          data.booking_policy = { cancel_minutes: policy.cancel_minutes, reschedule_minutes: policy.reschedule_minutes };
        }
        Object.assign(data, { id: proof.id, name: proof.name, phone: proof.phone, country_code: proof.country_code, time: body.time, notes: body.notes || '', ...(proof.user_id ? { account_user_id: proof.user_id, session_id: proof.session_id } : {}) });
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
      if (body.action === 'book') {
        const proof = await verify(body.verification, 'verified');
        // Only a successful guest booking earns a receipt capability. It is
        // short-lived, binds exactly one booking, and never appears in a URL.
        const receipt = result as Record<string, unknown>;
        if (proof && !proof.user_id && receipt.id === proof.id) {
          // Native retries retain the original receipt deadline; a retry cannot
          // extend the capability to attach an appointment to an account.
          if (!deps.recover) return reply(200, { ...receipt, claimToken: await sign({ ...proof, purpose: 'receipt', expires: Date.now() + 60 * 60_000 }) });
          const original = await deps.recover(proof);
          const expires = original ? Date.parse(String(original.created_at)) + 60 * 60_000 : proof.expires + 50 * 60_000;
          return reply(200, { ...receipt, ...(expires > Date.now() ? { claimToken: await sign({ ...proof, purpose: 'receipt', expires }) } : {}) });
        }
      }
      return reply(200, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const packageFailure = message.match(/INVALID_PACKAGE_SELECTION|PACKAGE_(?:UNAVAILABLE|DATE_UNAVAILABLE|CHANGED)/)?.[0];
      if (packageFailure) return reply(409, { error: packageFailure });
      if (/SELF_BOOKING_NOT_ALLOWED/.test(message)) return reply(409, { error: 'SELF_BOOKING_NOT_ALLOWED' });
      if (/BOOKING_POLICY_CHANGED/.test(message)) return reply(409, { error: 'BOOKING_POLICY_CHANGED' });
      if (message === 'PHONE_RATE_LIMIT') return reply(429, { error: message });
      if (message === 'PHONE_UNAVAILABLE') return reply(503, { error: message });
      if (/ATTEMPT_CLOSED/.test(message)) return reply(409, { error: 'ATTEMPT_CLOSED' });
      if (/PRICE_CHANGED/.test(message)) return reply(409, { error: 'PRICE_CHANGED' });
      if (/PHONE_IN_USE/.test(message)) return reply(409, { error: 'PHONE_IN_USE' });
      if (/SLOT_UNAVAILABLE|overlapping|Booking conflict|23P01/.test(message)) return reply(409, { error: 'SLOT_UNAVAILABLE' });
      if (/INVALID_(SELECTION|DATE|REQUEST)|BOOKING_UNAVAILABLE/.test(message)) return reply(400, { error: message.match(/INVALID_(SELECTION|DATE|REQUEST)|BOOKING_UNAVAILABLE/)![0] });
      return reply(503, { error: 'UNAVAILABLE' });
    }
  };
}
