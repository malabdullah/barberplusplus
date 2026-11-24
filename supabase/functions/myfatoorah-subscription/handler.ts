export const testProject = 'https://qvkucvcjmojjbphlzlks.supabase.co';
export const testSite = 'https://barber-test.alabdullah-cs.workers.dev';
const api = 'https://apitest.myfatoorah.com/v3/';
type Payload = Record<string, any>;
type Config = {
  token: string;
  allowsStaff: (request: Request) => Promise<boolean>;
  manager: (token: string, action: string, data: Payload) => Promise<any>;
  provider: (action: string, id: string, data: Payload) => Promise<any>;
  fetcher?: typeof fetch;
};

function reply(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' } });
}

export function fils(value: unknown) {
  const match = String(value).match(/^(\d{1,9})(?:\.(\d{1,3}))?$/);
  return match ? Number(match[1]) * 1000 + Number((match[2] || '').padEnd(3, '0')) : null;
}

export function checkoutUrl(value: unknown) {
  const url = new URL(String(value));
  if (url.origin !== 'https://demo.myfatoorah.com' || url.username || url.password) {
    throw new Error('MYFATOORAH_CREATE_UNCERTAIN');
  }
  return url.href;
}

async function readBody(req: Request) {
  const reader = req.body?.getReader();
  if (!reader) throw new Error('MYFATOORAH_INVALID');
  let size = 0;
  let raw = '';
  const decoder = new TextDecoder('utf-8', { fatal: true });
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return JSON.parse(raw + decoder.decode());
      size += value.length;
      if (size > 8192) throw new Error('MYFATOORAH_INVALID');
      raw += decoder.decode(value, { stream: true });
    }
  } finally { await reader.cancel().catch(() => {}); }
}

export function createHandler(config: Config) {
  async function request(method: string, path: string, body?: Payload, id?: string) {
    const response = await (config.fetcher || fetch)(api + path, {
      method, redirect: 'error', signal: AbortSignal.timeout(12000),
      headers: { Authorization: 'Bearer ' + config.token, 'Content-Type': 'application/json',
        Accept: 'application/json', ...(id ? { 'Idempotency-Key': id } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  }

  async function create(attempt: Payload) {
    if (!await config.provider('claim-create', attempt.id, {})) return attempt;
    const expires = Math.min(Date.parse(attempt.createdAt) + 20 * 60000,
      attempt.quote.kind === 'capacity' ? Date.parse(attempt.quote.periodEnd) : Infinity);
    if (!Number.isFinite(expires) || expires <= Date.now() + 60000) {
      return await config.provider('create-rejected', attempt.id, {});
    }
    const response = await request('POST', 'payments', {
      PaymentMethod: attempt.quote.paymentMethod,
      Order: { Amount: attempt.quote.totalFils / 1000, Currency: 'KWD', ExternalIdentifier: attempt.id },
      PaymentExpiry: new Date(expires).toISOString(), NotificationOption: 'LINK', OperationType: 'PAY',
      Language: 'EN',
      IntegrationUrls: { Redirection: testSite + '/dashboard/billing?myfatoorah=return&attempt=' + attempt.id },
    }, 'barber-test-' + attempt.id);
    if ([400, 401, 403, 422].includes(response.status) && response.body?.IsSuccess === false) {
      return await config.provider('create-rejected', attempt.id, {});
    }
    if (![200, 201].includes(response.status) || response.body?.IsSuccess !== true) {
      throw new Error('MYFATOORAH_CREATE_UNCERTAIN');
    }
    const data = response.body.Data;
    if (!/^\d{1,30}$/.test(String(data?.InvoiceId))) throw new Error('MYFATOORAH_CREATE_UNCERTAIN');
    return await config.provider('attach', attempt.id, {
      sessionId: String(data.InvoiceId), checkoutUrl: checkoutUrl(data.PaymentURL),
    });
  }

  async function check(attempt: Payload, paymentId: unknown) {
    const reference = await config.provider('inquire', attempt.id, {});
    if (!reference) return attempt;
    if (typeof paymentId !== 'string' || !/^\d{1,100}$/.test(paymentId)) return attempt;
    const response = await request('GET', 'payments/' + paymentId);
    if (response.status !== 200 || response.body?.IsSuccess !== true) throw new Error('MYFATOORAH_VERIFY_UNAVAILABLE');
    const { Invoice: invoice, Transaction: transaction, Amount: amount } = response.body.Data || {};
    if (String(invoice?.Id) !== reference.sessionId || invoice?.ExternalIdentifier !== attempt.id
      || transaction?.PaymentId !== paymentId || amount?.BaseCurrency !== 'KWD'
      || fils(amount.ValueInBaseCurrency) !== attempt.quote.totalFils) throw new Error('MYFATOORAH_PROVIDER_MISMATCH');
    if (invoice.Status === 'PAID' && transaction.Status === 'SUCCESS') {
      return await config.provider('capture', attempt.id, {
        orderId: attempt.id, sessionId: String(invoice.Id), trackId: paymentId,
        currency: amount.BaseCurrency, totalFils: fils(amount.ValueInBaseCurrency),
      });
    }
    // A failed card attempt can still be retried at the same hosted invoice.
    // Keep the checkout pending instead of releasing it for a duplicate payment.
    return attempt;
  }

  return async (req: Request) => {
    if (req.method !== 'POST') return reply({ error: 'MYFATOORAH_METHOD' }, 405);
    if (!config.token) return reply({ error: 'MYFATOORAH_UNAVAILABLE' }, 503);
    try {
      if (!new URL(req.url).pathname.endsWith('/myfatoorah-subscription') || !await config.allowsStaff(req)) {
        return reply({ error: 'MYFATOORAH_FORBIDDEN' }, 403);
      }
      const token = req.headers.get('authorization')?.match(/^Bearer ([\w.-]+)$/)?.[1];
      if (!token) return reply({ error: 'MYFATOORAH_FORBIDDEN' }, 401);
      const { action, businessId, ...data } = await readBody(req);
      if (!['read', 'quote', 'start', 'check'].includes(action) || typeof businessId !== 'string') {
        throw new Error('MYFATOORAH_INVALID');
      }
      if (action === 'start') {
        const current = await config.manager(token, 'start', { businessId, ...data });
        return reply({ attempt: current.attempt.state === 'creating' ? await create(current.attempt) : current.attempt });
      }
      const current = await config.manager(token, action === 'check' ? 'read' : action, { businessId, ...data });
      if (action !== 'check' || !current.eligible || !current.attempt) return reply(current);
      // Callback hints never select another business or another attempt.
      if (data.attemptId && data.attemptId !== current.attempt.id) throw new Error('MYFATOORAH_PROVIDER_MISMATCH');
      return reply({ ...current, attempt: current.attempt.state === 'pending'
        ? await check(current.attempt, data.paymentId) : current.attempt });
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const code = /^(MYFATOORAH|BILLING)_[A-Z_]+$/.test(message) ? message
        : error instanceof SyntaxError ? 'MYFATOORAH_INVALID' : 'MYFATOORAH_UNAVAILABLE';
      return reply({ error: code }, code === 'MYFATOORAH_FORBIDDEN' ? 403 : code === 'MYFATOORAH_INVALID' ? 400
        : /UNAVAILABLE|UNCERTAIN|MISMATCH/.test(code) ? 503 : 409);
    }
  };
}
