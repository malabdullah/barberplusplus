import { nativeWalletReturnUrl, requestsNativeWallet } from '../_shared/native-wallet-test.ts';
import { authorizedWebhook, bodyText, fils, sandboxRequester } from '../_shared/upayments-sandbox.ts';

export const walletProject = 'https://qvkucvcjmojjbphlzlks.supabase.co';
export const walletSite = 'https://barber-test.alabdullah-cs.workers.dev';
const hookUrl = walletProject + '/functions/v1/b-wallet/webhook/';
const returnUrl = walletSite + '/customer/wallet?payment=return';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const session = /^[A-Za-z0-9_-]{10,90}$/;
const reference = /^[A-Za-z0-9_-]{12,255}$/;
type Identity = { user_id: string; session_id: string };
type Data = Record<string, unknown>;
type Topup = { id: string; state: string; amountFils: string; create?: boolean; sessionId?: string };
type Config = {
  token: string;
  secret: string;
  fetcher?: typeof fetch;
  allows: (req: Request) => Promise<boolean>;
  identify: (token: string) => Promise<Identity | null>;
  rpc: (action: string, id: string | null, data: Data) => Promise<unknown>;
};

const fromOrder = (value: string) => value.replace(/^(........)(....)(....)(....)(............)$/, '$1-$2-$3-$4-$5');
const orderFor = (id: string) => id.replaceAll('-', '');
function json(status: number, data: unknown) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export function createWalletHandler(config: Config) {
  const request = sandboxRequester(config);

  async function reconcile(id: string) {
    const topup = await config.rpc('reconcile', id, {}) as Topup | null;
    const sessionId = topup?.sessionId;
    if (!topup || !['pending', 'review', 'failed'].includes(topup.state) || !session.test(sessionId || '')) return;
    const result = await request('GET', 'get-payment-status?session_id=' + encodeURIComponent(sessionId!));
    const transaction = result.body?.data?.transaction;
    if (result.http !== 201 || result.body?.status !== true || !transaction) throw Error('WALLET_PROVIDER_UNAVAILABLE');
    const order = orderFor(id);
    if (transaction.merchant_requested_order_id !== order || transaction.reference !== order
      || transaction.notify_url !== hookUrl + order) throw Error('WALLET_PROVIDER_MISMATCH');
    if (transaction.isTerminalStatus !== true) return;
    if (transaction.result === 'CAPTURED') {
      const amount = fils(transaction.total_paid_non_kwd);
      if (amount === null || transaction.currency_type !== 'KWD' || !session.test(transaction.track_id || '')
        || !reference.test(transaction.order_id || '')) throw Error('WALLET_PROVIDER_MISMATCH');
      await config.rpc('capture', id, { session_id: sessionId, track_id: transaction.track_id,
        order_id: transaction.order_id, amount_fils: amount, currency: 'KWD' });
    } else if (['FAILED', 'NOT CAPTURED', 'CANCELED'].includes(transaction.result)) {
      await config.rpc('fail', id, {});
    }
  }

  async function start(id: string, amount: number, identity: Identity, language: string, native: boolean) {
    const topup = await config.rpc('start', id, { ...identity, amount_fils: amount }) as Topup;
    if (!topup.create) return topup;
    const order = orderFor(topup.id);
    const callbackUrl = native ? nativeWalletReturnUrl : returnUrl;
    try {
      const response = await request('POST', 'charge', JSON.stringify({
        order: { id: order, reference: order, currency: 'KWD', amount: Number(topup.amountFils) / 1000,
          description: 'Barber++ Test B-Wallet top-up' },
        reference: { id: order }, tokens: {}, language,
        returnUrl: callbackUrl, cancelUrl: callbackUrl, notificationUrl: hookUrl + order, paymentLinkExpiryInMinutes: 5,
      }));
      if ([400, 401, 403, 422].includes(response.http) && response.body?.status === false) {
        return await config.rpc('fail', topup.id, {});
      }
      const link = new URL(response.body?.data?.link || '');
      const sessionId = link.searchParams.get('session_id') || '';
      if (response.http !== 201 || response.body?.status !== true || link.origin !== 'https://sandbox.upayments.com'
        || link.username || link.password || !session.test(sessionId)) throw Error('WALLET_PROVIDER_UNAVAILABLE');
      return await config.rpc('attach', topup.id, { session_id: sessionId, checkout_url: link.href });
    } catch {
      // UPayments may have created the session before the network failed. Only
      // reconciliation or operator review can clear this attempt.
      return await config.rpc('review', topup.id, {});
    }
  }

  return async (req: Request) => {
    if (req.method !== 'POST') return json(405, { error: 'INVALID_REQUEST' });
    const path = new URL(req.url).pathname;
    const hook = path.match(/\/b-wallet\/webhook\/([a-f0-9]{32})$/);
    const sweep = path.endsWith('/b-wallet/sweep');
    try {
      if (hook) {
        if (!await authorizedWebhook(req, await bodyText(req), config.secret, hookUrl + hook[1])) return json(401, {});
        await reconcile(fromOrder(hook[1]));
        return new Response(null, { status: 204 });
      }
      if (sweep) {
        const key = req.headers.get('x-booking-sweep') || '';
        if (!/^[a-f0-9]{64}$/.test(key)) return json(401, {});
        const ids = await config.rpc('due-ids', null, { worker_key: key }) as string[];
        await Promise.allSettled(ids.map(async id => {
          try { await reconcile(id); } finally { await config.rpc('delay', id, {}); }
        }));
        return new Response(null, { status: 204 });
      }
      if (!await config.allows(req)) return json(403, { error: 'WALLET_FORBIDDEN' });
      const identity = await config.identify(req.headers.get('authorization')?.replace(/^Bearer /i, '') || '');
      if (!identity) return json(401, { error: 'AUTH_REQUIRED' });
      let body;
      try { body = JSON.parse(await bodyText(req)); } catch { return json(400, { error: 'WALLET_INVALID' }); }
      if (body?.action === 'latest') return json(200, { topup: await config.rpc('latest', null, identity) });
      if (typeof body?.id !== 'string' || !uuid.test(body.id)) return json(400, { error: 'WALLET_INVALID' });
      if (body.action === 'check') {
        const topup = await config.rpc('read', body.id, identity) as Topup | null;
        if (!topup) return json(404, { error: 'WALLET_NOT_FOUND' });
        if (['pending', 'review'].includes(topup.state)) await reconcile(body.id);
        return json(200, { topup: await config.rpc('read', body.id, identity) });
      }
      if (body.action !== 'start' || !Number.isSafeInteger(body.amountFils) || body.amountFils < 1000 || body.amountFils > 100000) {
        return json(400, { error: 'WALLET_INVALID_TOPUP' });
      }
      return json(200, { topup: await start(body.id, body.amountFils, identity, body.language === 'ar' ? 'ar' : 'en', requestsNativeWallet(req)) });
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : '';
      if (['WALLET_FORBIDDEN','WALLET_DISABLED'].includes(message)) return json(403, { error: message });
      if (['WALLET_TOPUP_PENDING','WALLET_RETRY_CHANGED'].includes(message)) return json(409, { error: message });
      return json(503, { error: 'WALLET_PROVIDER_UNAVAILABLE' });
    }
  };
}
