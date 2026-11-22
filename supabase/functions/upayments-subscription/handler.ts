const apiBase = 'https://sandboxapi.upayments.com/api/v1/';
export const testProject = 'https://qvkucvcjmojjbphlzlks.supabase.co';
export const testSite = 'https://barber-test.alabdullah-cs.workers.dev';
export const webhookUrl = testProject + '/functions/v1/upayments-subscription/webhook';
const trackPattern = /^[A-Za-z0-9_-]{10,100}$/;
const orderPattern = /^[a-f0-9]{32}$/;
const encoder = new TextEncoder();

type Payload = Record<string, unknown>;
type Attempt = { id: string; state: string; quote: { totalFils: number } };
type Config = {
  token: string;
  secret: string;
  allowsStaff: (request: Request) => Promise<boolean>;
  manager: (token: string, action: string, data: Payload) => Promise<unknown>;
  provider: (action: string, id: string, data: Payload) => Promise<unknown>;
  fetcher?: typeof fetch;
};

function response(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' } });
}

async function signedDigest(secret: string, value: string) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), {
    name: 'HMAC', hash: 'SHA-256',
  }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}

export async function sign(secret: string, value: string) {
  return btoa(String.fromCharCode(...await signedDigest(secret, value)));
}

async function authorizedWebhook(req: Request, raw: string, secret: string, notificationUrl: string) {
  const stamp = req.headers.get('x-timestamp') || '';
  const signature = req.headers.get('x-signature') || '';
  if (!/^\d{10}$/.test(stamp) || Math.abs(Date.now() / 1000 - Number(stamp)) > 300
    || !/^[A-Za-z0-9+/]{43}=$/.test(signature)) return false;
  const actual = atob(signature);
  const expected = await signedDigest(secret, stamp + 'POST' + notificationUrl + raw);
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= expected[i] ^ actual.charCodeAt(i);
  return difference === 0;
}

async function bodyText(req: Request) {
  const reader = req.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let amount = 0;
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return text + decoder.decode();
      amount += value.byteLength;
      if (amount > 8192) throw new Error('UPAYMENTS_INVALID');
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

function fils(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const match = String(value).match(/^(\d{1,9})(?:\.(\d{1,3}))?$/);
  return match ? Number(match[1]) * 1000 + Number((match[2] || '').padEnd(3, '0')) : null;
}

function uuid(orderId: string) {
  return [orderId.slice(0, 8), orderId.slice(8, 12), orderId.slice(12, 16),
    orderId.slice(16, 20), orderId.slice(20)].join('-');
}

export function createHandler(config: Config) {
  const requestProvider = async (method: string, path: string, raw = '') => {
    const stamp = String(Math.floor(Date.now() / 1000));
    const result = await (config.fetcher || fetch)(apiBase + path, {
      method, body: raw || undefined, redirect: 'error', signal: AbortSignal.timeout(9000),
      headers: {
        Authorization: 'Bearer ' + config.token, Accept: 'application/json',
        'Content-Type': 'application/json', 'X-Timestamp': stamp,
        'X-Signature': await sign(config.secret, stamp + method + path + raw),
      },
    });
    return { http: result.status, body: await result.json().catch(() => null) };
  };

  const reconcile = async (orderId: string, reference: { sessionId: string }) => {
    const { sessionId } = reference;
    if (!trackPattern.test(sessionId)) throw new Error('UPAYMENTS_PROVIDER_MISMATCH');
    // UPayments returns an internal session ID after capture. Querying with the
    // stored checkout token binds the result to this session across both states.
    const result = await requestProvider('GET', 'get-payment-status?session_id=' + encodeURIComponent(sessionId));
    const transaction = result.body?.data?.transaction;
    if (result.http !== 201 || result.body?.status !== true || !transaction) {
      throw new Error('UPAYMENTS_VERIFY_UNAVAILABLE');
    }
    if (transaction.merchant_requested_order_id !== orderId || transaction.reference !== orderId
      || ![webhookUrl, webhookUrl + '/' + orderId].includes(transaction.notify_url)) {
      throw new Error('UPAYMENTS_PROVIDER_MISMATCH');
    }

    const evidence = {
      orderId, sessionId, trackId: transaction.track_id, currency: transaction.currency_type,
      totalFils: fils(transaction.total_paid_non_kwd),
    };
    if (transaction.result === 'CAPTURED') {
      if (!trackPattern.test(String(transaction.track_id || ''))) throw new Error('UPAYMENTS_PROVIDER_MISMATCH');
      return await config.provider('capture', uuid(orderId), evidence);
    }
    // An unsuccessful card attempt can leave the checkout session usable.
    if (transaction.result === 'NOT CAPTURED' && transaction.isTerminalStatus === true) {
      return await config.provider('failed', uuid(orderId), evidence);
    }
    return null;
  };

  async function createCharge(attempt: Attempt, language: unknown) {
    if (!await config.provider('claim-create', attempt.id, {})) return attempt;
    const id = attempt.id.replaceAll('-', '');
    const billing = testSite + '/dashboard/billing?upayments=return';
    const result = await requestProvider('POST', 'charge', JSON.stringify({
      order: { id, reference: id, description: 'Barber++ Test subscription', amount: attempt.quote.totalFils / 1000, currency: 'KWD' },
      reference: { id }, tokens: {}, language: language === 'ar' ? 'ar' : 'en',
      returnUrl: billing, cancelUrl: billing, notificationUrl: webhookUrl + '/' + id,
      paymentLinkExpiryInMinutes: 20,
    }));
    if ([400,401,403,422].includes(result.http) && result.body?.status === false) {
      return await config.provider('create-rejected', attempt.id, {});
    }
    if (result.http !== 201 || result.body?.status !== true) throw new Error('UPAYMENTS_CREATE_UNCERTAIN');
    const link = new URL(result.body.data?.link);
    const sessionId = link.searchParams.get('session_id') || '';
    if (link.origin !== 'https://sandbox.upayments.com' || link.username || link.password || !trackPattern.test(sessionId)) {
      throw new Error('UPAYMENTS_CREATE_UNCERTAIN');
    }
    return await config.provider('attach', attempt.id, { sessionId, checkoutUrl: link.href });
  }

  async function handleWebhook(req: Request, routeOrder?: string) {
    const raw = await bodyText(req);
    const notificationUrl = routeOrder ? webhookUrl + '/' + routeOrder : webhookUrl;
    if (!await authorizedWebhook(req, raw, config.secret, notificationUrl)) return response({ error: 'UPAYMENTS_SIGNATURE' }, 401);
    // The actual sandbox webhook body can differ from the documented sample.
    // Use the signed order path and look up the original session for evidence.
    const hint = routeOrder || JSON.parse(raw).requested_order_id;
    if (typeof hint !== 'string' || !orderPattern.test(hint)) {
      return response({ error: 'UPAYMENTS_INVALID' }, 400);
    }
    const pending = await config.provider('inquire', uuid(hint), {}) as { sessionId: string } | null;
    if (pending?.sessionId) await reconcile(hint, pending);
    return response({ received: true });
  }

  return async (req: Request) => {
    if (req.method !== 'POST') return response({ error: 'UPAYMENTS_METHOD' }, 405);
    if (!config.token || !config.secret) return response({ error: 'UPAYMENTS_UNAVAILABLE' }, 503);
    const path = new URL(req.url).pathname;
    try {
      const webhook = path.match(/\/upayments-subscription\/webhook(?:\/([a-f0-9]{32}))?$/);
      if (webhook) return await handleWebhook(req, webhook[1]);
      if (!path.endsWith('/upayments-subscription') || !await config.allowsStaff(req)) {
        return response({ error: 'UPAYMENTS_FORBIDDEN' }, 403);
      }
      const token = req.headers.get('authorization')?.match(/^Bearer ([\w.-]+)$/)?.[1];
      if (!token) return response({ error: 'UPAYMENTS_FORBIDDEN' }, 401);
      const { action, businessId, ...data } = JSON.parse(await bodyText(req));
      if (!['read','quote','start','check'].includes(action) || typeof businessId !== 'string') {
        return response({ error: 'UPAYMENTS_INVALID' }, 400);
      }
      if (action === 'start') {
        const result = await config.manager(token, 'start', { businessId, ...data }) as { attempt: Attempt; create: boolean };
        if (result.attempt.state !== 'creating') return response({ attempt: result.attempt });
        const attempt = await createCharge(result.attempt, data.language);
        return response({ attempt });
      }
      if (action === 'check') {
        const current = await config.manager(token, 'read', { businessId }) as { eligible: boolean; attempt: Attempt | null };
        if (!current.eligible || !current.attempt) return response(current);
        if (current.attempt.state === 'creating') {
          return response({ eligible: true, attempt: await createCharge(current.attempt, data.language) });
        }
        if (current.attempt.state !== 'pending') return response(current);
        const reference = await config.provider('inquire', current.attempt.id, {}) as { sessionId: string } | null;
        const attempt = reference && await reconcile(current.attempt.id.replaceAll('-', ''), reference);
        return response(attempt ? { eligible: true, attempt } : current);
      }
      return response(await config.manager(token, action, { businessId, ...data }));
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const known = /^(UPAYMENTS|BILLING)_[A-Z_]+$/.test(message) ? message
        : error instanceof SyntaxError ? 'UPAYMENTS_INVALID' : 'UPAYMENTS_UNAVAILABLE';
      return response({ error: known }, known === 'UPAYMENTS_FORBIDDEN' ? 403 : known === 'UPAYMENTS_INVALID' ? 400
        : ['UPAYMENTS_UNAVAILABLE','UPAYMENTS_VERIFY_UNAVAILABLE','UPAYMENTS_CREATE_UNCERTAIN','UPAYMENTS_PROVIDER_MISMATCH'].includes(known) ? 503 : 409);
    }
  };
}
