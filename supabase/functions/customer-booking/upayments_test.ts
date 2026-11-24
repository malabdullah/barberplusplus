import { bookingPaymentPilot, pilotProject, pilotSite } from './upayments.ts';
import { sign } from '../_shared/upayments-sandbox.ts';

const id = '44ca29a4-b646-4836-a62c-367463ef4307';
const order = id.replaceAll('-', '');
const cap = '7278c83d-73b3-43c6-af73-7f1bc69dfc44';
const session = 'checkout-session-1';
const hook = pilotProject + '/functions/v1/customer-booking/upayments/webhook/' + order;
const secret = 'sandbox-hmac-for-testing';

function fixture(options: { currency?: string; result?: string; terminal?: boolean; checkoutHost?: string; processed?: boolean } = {}) {
  const calls: { action: string; data: Record<string, unknown> }[] = [];
  const returnUrls: string[] = [];
  let state = 'pending';
  const pilot = bookingPaymentPilot({ secret, token: 'test-token', rpc: (action, _id, data) => {
    calls.push({ action, data });
    if (action === 'read' && data.capability !== cap) return Promise.resolve(null);
    if (action === 'start') return Promise.resolve({ id, create: true, totalFils: 5001, state: 'creating' });
    if (action === 'inquire') return Promise.resolve({ id, sessionId: session, state });
    if (action === 'capture') {
      if (data.currency !== 'KWD' || data.totalFils !== 5001) return Promise.reject(Error('UPAYMENTS_PROVIDER_MISMATCH'));
      state = 'paid';
    }
    if (action === 'failed') state = 'failed';
    return Promise.resolve({ id, state });
  }, fetcher: (url, request) => {
    if (new URL(String(url)).origin !== 'https://sandboxapi.upayments.com') throw Error('Unexpected provider');
    if (request?.method === 'POST') {
      const data = JSON.parse(String(request.body));
      if (data.returnUrl !== data.cancelUrl) throw Error('Inconsistent return URL');
      returnUrls.push(data.returnUrl);
      if (data.customer || data.order.amount !== 5.001 || data.notificationUrl !== hook) throw Error('Invalid charge request');
      return Promise.resolve(Response.json({ status: true, data: {
        link: 'https://' + (options.checkoutHost || 'sandbox.upayments.com') + '?session_id=' + session,
      } }, { status: 201 }));
    }
    return Promise.resolve(Response.json({ status: true, data: { transaction: {
      merchant_requested_order_id: order, reference: order, notify_url: hook,
      track_id: options.processed === false ? '' : 'track-000001', status: options.processed === false ? 'pending' : 'done',
      currency_type: options.currency || 'KWD', total_paid_non_kwd: '5.001',
      isTerminalStatus: options.terminal !== false, result: options.result || 'CAPTURED',
      order_id: 'provider-original-order-id', refund_order_id: 'provider-refund-order-id',
    } } }, { status: 201 }));
  } });
  return { pilot, calls, returnUrls };
}

Deno.test('payment capability and server-verified exact capture drive receipt status', async () => {
  const { pilot, calls } = fixture();
  if (await pilot.check(id) !== null || calls.some(call => call.action === 'inquire')) throw Error('unguarded status lookup');
  await pilot.start({ id, email: 'synthetic@example.test' }, cap);
  if (!calls.some(call => call.action === 'attach')) throw Error('sandbox checkout not attached');
  if ((await pilot.check(cap))?.state !== 'paid') throw Error('capture was not forwarded');
});

Deno.test('an unverified callback cannot finalize a booking', async () => {
  const { pilot, calls } = fixture();
  const stamp = String(Math.floor(Date.now() / 1000));
  const body = '{"test":true}';
  const onWeb = () => Promise.resolve(new Response(null));
  const response = await pilot.background(new Request(hook, { method: 'POST', body, headers: {
    'x-timestamp': stamp, 'x-signature': await sign(secret, stamp + 'POST' + hook + 'other'),
  } }), onWeb);
  if (response.status !== 401 || calls.length) throw Error('unverified callback accepted');
  const valid = await pilot.background(new Request(hook, { method: 'POST', body, headers: {
    'x-timestamp': stamp, 'x-signature': await sign(secret, stamp + 'POST' + hook + body),
  } }), onWeb);
  if (valid.status !== 204 || !calls.some(call => call.action === 'capture')) throw Error('valid callback not reconciled');
});

Deno.test('a card attempt releases the hold only after terminal failure', async () => {
  const interim = fixture({ result: 'NOT CAPTURED', terminal: false });
  const terminal = fixture({ result: 'CANCELED' });
  const rejected = await interim.pilot.check(cap);
  if (rejected?.state !== 'pending' || !rejected.retryableFailure) throw Error('processed failure must permit retry without releasing the hold');
  const untouched = fixture({ result: 'NOT CAPTURED', terminal: false, processed: false });
  if ((await untouched.pilot.check(cap))?.retryableFailure) throw Error('unopened checkout displayed as a failed attempt');
  if ((await terminal.pilot.check(cap))?.state !== 'failed') throw Error('canceled checkout was not released');
});

Deno.test('web and native payments keep independent destination URLs', async () => {
  const { pilot, returnUrls } = fixture();
  await pilot.start({ id }, cap);
  await pilot.start({ id }, cap, 0, true);
  if (returnUrls[0] !== pilotSite + '/book?payment=return' ||
      returnUrls[1] !== 'https://barber-open-test.alabdullah-cs.workers.dev/payments/provider-return') {
    throw Error('Wrong payment return destination');
  }
});
