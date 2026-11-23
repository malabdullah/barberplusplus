import { authorizedWebhook, bodyText, fils, sandboxRequester } from '../_shared/upayments-sandbox.ts';

export const pilotProject = 'https://qvkucvcjmojjbphlzlks.supabase.co';
export const pilotSite = 'https://barber-test.alabdullah-cs.workers.dev';
const callback = pilotProject + '/functions/v1/customer-booking/upayments/webhook/';
const tokenPattern = /^[A-Za-z0-9_-]{10,90}$/;
const orderPattern = /^[A-Za-z0-9_-]{12,255}$/;
const returnUrl = pilotSite + '/book?payment=return';

type Data = Record<string, unknown>;
type Attempt = { id: string; state: string; totalFils: number; create?: boolean; accountSaved: boolean; retryableFailure?: boolean };
type Reference = {
  state: string; sessionId: string | null; providerOrderId: string | null; providerRefundKey: string | null;
  refundState: string | null; refundOrderId: string | null;
};
type Config = {
  token: string; secret: string; fetcher?: typeof fetch;
  rpc: (action: string, id: string | null, data: Data) => Promise<unknown>;
};

export function bookingPaymentPilot(config: Config) {
  const request = sandboxRequester(config);
  const call = (action: string, id: string | null, data: Data = {}) => config.rpc(action, id, data);

  async function start(data: Data, capability: string) {
    const attempt = await call('start', String(data.id), { booking: data, capability }) as Attempt;
    if (!attempt.create) return attempt;

    const order = attempt.id.replaceAll('-', '');
    const response = await request('POST', 'charge', JSON.stringify({
      order: { id: order, reference: order, currency: 'KWD', amount: attempt.totalFils / 1000,
        description: 'Barber++ Test appointment' },
      reference: { id: order }, tokens: {}, language: data.language === 'ar' ? 'ar' : 'en',
      returnUrl, cancelUrl: returnUrl, notificationUrl: callback + order, paymentLinkExpiryInMinutes: 5,
    }));
    if ([400,401,403,422].includes(response.http) && response.body?.status === false) {
      return await call('failed', attempt.id);
    }
    if (response.http !== 201 || response.body?.status !== true) throw Error('UPAYMENTS_CHECK_UNAVAILABLE');
    const link = new URL(response.body.data.link);
    const sessionId = link.searchParams.get('session_id') || '';
    if (link.origin !== 'https://sandbox.upayments.com' || link.username || link.password || !tokenPattern.test(sessionId)) {
      throw Error('UPAYMENTS_CHECK_UNAVAILABLE');
    }
    return await call('attach', attempt.id, { sessionId, checkoutUrl: link.href });
  }

  async function reconcile(id: string, sessionId: string) {
    if (!tokenPattern.test(sessionId)) throw Error('UPAYMENTS_PROVIDER_MISMATCH');
    const order = id.replaceAll('-', '');
    const response = await request('GET', 'get-payment-status?session_id=' + encodeURIComponent(sessionId));
    const transaction = response.body?.data?.transaction;
    if (response.http !== 201 || response.body?.status !== true || !transaction) throw Error('UPAYMENTS_CHECK_UNAVAILABLE');
    if (transaction.merchant_requested_order_id !== order || transaction.reference !== order
      || transaction.notify_url !== callback + order) throw Error('UPAYMENTS_PROVIDER_MISMATCH');
    if (transaction.result === 'CAPTURED' && transaction.isTerminalStatus === true) {
      const { track_id: trackId, order_id: providerOrderId, refund_order_id: providerRefundKey } = transaction;
      if (!tokenPattern.test(trackId || '') || !orderPattern.test(providerOrderId || '') || !orderPattern.test(providerRefundKey || '')) {
        throw Error('UPAYMENTS_PROVIDER_MISMATCH');
      }
      await call('capture', id, {
        sessionId, trackId, providerOrderId, providerRefundKey,
        totalFils: fils(transaction.total_paid_non_kwd), currency: transaction.currency_type,
      });
      return false;
    }
    const unsuccessful = ['NOT CAPTURED', 'CANCELED', 'FAILED'].includes(transaction.result);
    if (unsuccessful && transaction.isTerminalStatus === true) {
      await call('failed', id);
      return false;
    }
    // A fresh checkout also reports NOT CAPTURED. Only a processed attempt
    // with a provider track ID proves the customer actually tried to pay.
    return unsuccessful && transaction.status === 'done' && tokenPattern.test(transaction.track_id || '');
  }

  async function refund(id: string, reference: Reference) {
    if (reference.refundState === 'pending' && reference.providerOrderId && reference.refundOrderId) {
      const result = await request('GET', 'check-refund/' + encodeURIComponent(reference.providerOrderId));
      const data = result.body?.data?.refund;
      const row = Array.isArray(data) ? data.find(entry => entry.order_id === reference.refundOrderId) : null;
      if (result.http === 201 && result.body?.status === true && row?.is_refunded === true && row.status === 'Refunded') {
        await call('refunded', id, { refundOrderId: reference.refundOrderId });
      }
      if (row && ['Failed','Rejected','Cancelled','Canceled'].includes(row.status)) await call('refund-review', id);
    } else if (reference.refundState === null && reference.providerRefundKey && await call('claim-refund', id) === true) {
      // A transport failure is ambiguous. Never retry the POST automatically.
      try {
        const inquiry = await call('inquire', id) as Reference & { totalFils: number };
        const result = await request('POST', 'create-refund', JSON.stringify({
          orderId: reference.providerRefundKey, totalPrice: inquiry.totalFils / 1000, reference: id.replaceAll('-', ''),
        }));
        const refundOrderId = result.body?.data?.orderId;
        if (result.http === 201 && result.body?.status === true && orderPattern.test(refundOrderId || '')) {
          await call('refund-pending', id, { refundOrderId });
          return;
        }
      } catch { /* The dispatcher records review and makes no repeat request. */ }
      await call('refund-review', id);
    }
  }

  async function check(capability: string) {
    const attempt = await call('read', null, { capability }) as Attempt | null;
    if (!attempt || !['pending', 'expired'].includes(attempt.state)) return attempt;
    const reference = await call('inquire', attempt.id) as Reference;
    let retryableFailure = false;
    if (reference?.sessionId) {
      try { retryableFailure = await reconcile(attempt.id, reference.sessionId); }
      catch (error) {
        if (attempt.state !== 'expired') throw error;
        // The customer can leave an expired hold. The server still checks for
        // delayed capture and starts a refund if a payment comes through.
      }
    }
    const current = await call('read', null, { capability }) as Attempt;
    return current.state === 'pending' && retryableFailure ? { ...current, retryableFailure } : current;
  }

  async function background(req: Request, web: (req: Request) => Promise<Response>) {
    const path = new URL(req.url).pathname;
    const hook = path.match(/\/customer-booking\/upayments\/webhook\/([a-f0-9]{32})$/);
    const sweep = path.endsWith('/customer-booking/upayments/sweep');
    if (!hook && !sweep) return await web(req);
    if (req.method !== 'POST') return new Response(null, { status: 405 });
    if (hook && !/^\d{10}$/.test(req.headers.get('x-timestamp') || '')) return new Response(null, { status: 401 });
    if (sweep && !/^[a-f0-9]{64}$/.test(req.headers.get('x-booking-sweep') || '')) return new Response(null, { status: 401 });
    try {
      if (hook) {
        const verifiedBody = await bodyText(req);
        if (!await authorizedWebhook(req, verifiedBody, config.secret, callback + hook[1])) return new Response(null, { status: 401 });
        const id = hook[1].replace(/^(........)(....)(....)(....)(............)$/, '$1-$2-$3-$4-$5');
        const reference = await call('inquire', id) as Reference | null;
        if (reference?.sessionId && ['pending','expired','failed'].includes(reference.state)) await reconcile(id, reference.sessionId);
      } else {
        const ids = await call('sweep', null, { secret: req.headers.get('x-booking-sweep') }) as string[];
        await Promise.allSettled(ids.map(async id => {
          try {
            const reference = await call('inquire', id) as Reference;
            if (reference.sessionId && ['pending','expired'].includes(reference.state)) await reconcile(id, reference.sessionId);
            else await refund(id, reference);
          } finally { await call('defer', id); }
        }));
      }
      return new Response(null, { status: 204 });
    } catch (error) {
      return new Response(null, { status: error instanceof Error && error.message.includes('UPAYMENTS_FORBIDDEN') ? 403 : 503 });
    }
  }

  return { start, check, slots: (data: Data) => call('slots', null, data), background };
}
