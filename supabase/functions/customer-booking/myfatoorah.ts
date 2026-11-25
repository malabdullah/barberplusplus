import { checkoutUrl, fils, transactionOutcome } from '../myfatoorah-subscription/handler.ts';
import { pilotSite } from './upayments.ts';

type Data = Record<string, any>;
type Config = { token: string; rpc: (action: string, id: string | null, data: Data) => Promise<any>; fetcher?: typeof fetch };
const api = 'https://apitest.myfatoorah.com/v3/';

// This adapter never handles card details and never trusts the browser return.
export function myfatoorahBooking(config: Config) {
  const call = (action: string, id: string | null = null, data: Data = {}) => config.rpc(action, id, data);
  async function request(method: string, path: string, body?: Data, id?: string) {
    const r = await (config.fetcher || fetch)(api + path, {
      method, redirect: 'error', signal: AbortSignal.timeout(12000),
      headers: { Authorization: 'Bearer ' + config.token, 'Content-Type': 'application/json',
        Accept: 'application/json', ...(id ? { 'Idempotency-Key': 'barber-test-booking-' + id } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  }
  async function checkout(attempt: Data, language: string) {
    if (!attempt.create || !await call('claim-create', attempt.id)) return attempt;
    const expires = Date.parse(attempt.holdUntil) - 30000;
    if (!Number.isFinite(expires) || expires <= Date.now() + 60000) return await call('failed', attempt.id);
    const r = await request('POST', 'payments', {
      Order: { Amount: attempt.totalFils / 1000, Currency: 'KWD', ExternalIdentifier: attempt.id },
      DisplayPaymentMethods: ['knet', 'card'],
      PaymentExpiry: new Date(expires).toISOString(), NotificationOption: 'LINK', OperationType: 'PAY',
      Language: language === 'ar' ? 'AR' : 'EN',
      IntegrationUrls: { Redirection: pilotSite + '/book?payment=return' },
    }, attempt.id);
    if ([400, 401, 403, 422].includes(r.status) && r.body?.IsSuccess === false) return await call('failed', attempt.id);
    if (![200, 201].includes(r.status) || r.body?.IsSuccess !== true || !/^\d{1,30}$/.test(String(r.body.Data?.InvoiceId))) {
      throw Error('UPAYMENTS_CHECK_UNAVAILABLE');
    }
    return await call('attach', attempt.id, { sessionId: String(r.body.Data.InvoiceId), checkoutUrl: checkoutUrl(r.body.Data.PaymentURL) });
  }
  async function reconcile(id: string) {
    const ref = await call('inquire', id);
    if (!ref?.sessionId || !['pending', 'expired', 'failed'].includes(ref.state)) return false;
    const r = await request('GET', 'invoices/' + ref.sessionId);
    if (r.status === 200 && r.body?.IsSuccess === false && r.body.Message === 'No invoices match this InvoiceId') return false;
    if (r.status !== 200 || r.body?.IsSuccess !== true) throw Error('UPAYMENTS_CHECK_UNAVAILABLE');
    const data = r.body.Data;
    if (String(data?.Invoice?.Id) !== ref.sessionId || data.Invoice.ExternalIdentifier !== id
      || data.Amount?.BaseCurrency !== 'KWD' || fils(data.Amount.ValueInBaseCurrency) !== ref.totalFils) throw Error('UPAYMENTS_PROVIDER_MISMATCH');
    const transactions: Data[] = Array.isArray(data.Transactions) ? data.Transactions : [];
    const payment = transactions.find(t => t.Status === 'SUCCESS')?.PaymentId;
    if (!payment) {
      if (['EXPIRED', 'CANCELLED'].includes(data.Invoice.Status)) await call('failed', id);
      return transactionOutcome(transactions) !== null;
    }
    if (typeof payment !== 'string' || !/^\d{1,100}$/.test(payment)) throw Error('UPAYMENTS_PROVIDER_MISMATCH');
    const verified = await request('GET', 'payments/' + payment);
    if (verified.status !== 200 || verified.body?.IsSuccess !== true) throw Error('UPAYMENTS_CHECK_UNAVAILABLE');
    const { Invoice: invoice, Transaction: transaction, Amount: amount } = verified.body.Data || {};
    if (String(invoice?.Id) !== ref.sessionId || invoice?.ExternalIdentifier !== id || invoice.Status !== 'PAID'
      || transaction?.Status !== 'SUCCESS' || transaction?.PaymentId !== payment
      || amount?.BaseCurrency !== 'KWD' || fils(amount.ValueInBaseCurrency) !== ref.totalFils) throw Error('UPAYMENTS_PROVIDER_MISMATCH');
    await call('capture', id, { sessionId: ref.sessionId, paymentId: payment, externalIdentifier: id,
      currency: 'KWD', totalFils: ref.totalFils });
    return false;
  }
  return {
    route: (data: Data, id: string | null = null) => call('route', id, data),
    slots: (data: Data) => call('slots', null, data),
    async start(data: Data, capability: string, walletFils?: number, native = false) {
      if (native || walletFils) throw Error('UPAYMENTS_NOT_AVAILABLE');
      return await checkout(await call('start', data.id, { booking: data, capability }), data.language);
    },
    requestApproval: (data: Data) => call('request-approval', data.id, { booking: data }),
    async approvalCheckout(id: string, capability: string, walletFils: number, identity: Data, language: string, native = false) {
      if (native || walletFils) throw Error('UPAYMENTS_NOT_AVAILABLE');
      return await checkout(await call('approval-checkout', id, { ...identity, capability }), language);
    },
    async check(capability: string, identity: Data = {}) {
      const attempt = await call('read', null, { capability, ...identity });
      if (!attempt || !['pending', 'expired', 'failed'].includes(attempt.state)) return attempt;
      let retryableFailure = false;
      try { retryableFailure = await reconcile(attempt.id); }
      catch (error) { if (attempt.state !== 'expired') throw error; }
      const current = await call('read', null, { capability, ...identity });
      return current?.state === 'pending' && retryableFailure ? { ...current, retryableFailure } : current;
    },
    async sweep(secret: string) {
      const ids: string[] = await call('sweep', null, { secret });
      await Promise.allSettled(ids.map(async id => {
        try { await reconcile(id); } finally { await call('defer', id); }
      }));
    },
  };
}

// The website chooses a provider on the server. Native clients retain the old
// adapter until separately authorized to integrate MyFatoorah.
export function bookingProviderRouter(upayments: any, myfatoorah: ReturnType<typeof myfatoorahBooking>) {
  return {
    slots: async (data: Data) => await myfatoorah.route(data) ? myfatoorah.slots(data) : upayments.slots(data),
    start: async (data: Data, capability: string, wallet?: number) => await myfatoorah.route(data)
      ? myfatoorah.start(data, capability, wallet) : upayments.start(data, capability, wallet),
    check: async (capability: string, identity: Data = {}) => await myfatoorah.route({ capability })
      ? myfatoorah.check(capability, identity) : upayments.check(capability, identity),
    requestApproval: async (data: Data) => await myfatoorah.route(data)
      ? myfatoorah.requestApproval(data) : upayments.requestApproval(data),
    approvalCheckout: async (id: string, capability: string, wallet: number, identity: Data, language: string) => await myfatoorah.route({}, id)
      ? myfatoorah.approvalCheckout(id, capability, wallet, identity, language) : upayments.approvalCheckout(id, capability, wallet, identity, language),
  };
}
