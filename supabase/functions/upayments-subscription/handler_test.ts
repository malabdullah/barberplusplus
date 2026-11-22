import { createHandler, sign, testSite, webhookUrl } from './handler.ts';

const id = '11111111-2222-4333-8444-555555555555';
const order = id.replaceAll('-', '');
const session = 'sandbox-session-1234';
const track = 'sandbox-track-1234';
const secret = 'test-only-listener-secret';

function expect(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

function fixture(result = 'CAPTURED', terminal = true) {
  const calls: Array<{ action: string; data: unknown }> = [];
  let claimed = false;
  const handler = createHandler({
    token: 'sandbox-token', secret, allowsStaff: req => Promise.resolve(req.headers.has('x-test-gate')),
    manager: (_token, action) => Promise.resolve(action === 'start'
      ? { create: !claimed, attempt: { id, state: 'creating', quote: { totalFils: 25001 } } }
      : { eligible: true, attempt: { id, state: 'pending' } }),
    provider: (action, _id, data) => {
      calls.push({ action, data });
      if (action === 'claim-create') {
        const fresh = !claimed;
        claimed = true;
        return Promise.resolve(fresh);
      }
      if (action === 'inquire') return Promise.resolve({ sessionId: session });
      return Promise.resolve({ id, state: action === 'capture' ? 'paid' : action === 'failed' ? 'failed' : 'pending' });
    },
    fetcher: async (url, options) => {
      const endpoint = new URL(String(url));
      const path = endpoint.pathname.slice('/api/v1/'.length) + endpoint.search;
      const headers = new Headers(options?.headers);
      const raw = String(options?.body || '');
      expect(endpoint.origin === 'https://sandboxapi.upayments.com', 'sandbox origin');
      expect(headers.get('x-signature') === await sign(secret, headers.get('x-timestamp') + String(options?.method) + path + raw), 'request signature');
      if (path === 'charge') {
        const input = JSON.parse(raw);
        expect(input.order.amount === 25.001 && input.order.currency === 'KWD', 'fils conversion');
        expect(input.notificationUrl === webhookUrl && !input.customer, 'no customer data');
        return Response.json({ status: true, data: { link: 'https://sandbox.upayments.com/?session_id=' + session } }, { status: 201 });
      }
      return Response.json({ status: true, data: { transaction: {
        merchant_requested_order_id: order, result,
        isTerminalStatus: terminal, session_id: session, track_id: result === 'CAPTURED' ? track : '',
        total_paid_non_kwd: '25.001', currency_type: 'KWD',
      } } }, { status: 201 });
    },
  });
  return { handler, calls };
}

function staff(action: string) {
  return new Request(testSite + '/test-api/upayments-subscription', {
    method: 'POST', headers: { authorization: 'Bearer session', 'x-test-gate': '1' },
    body: JSON.stringify({ action, businessId: id }),
  });
}

Deno.test('two checkout starts only attach one provider session', async () => {
  const { handler, calls } = fixture();
  const responses = await Promise.all([handler(staff('start')), handler(staff('start'))]);
  expect(responses.every(value => value.ok), 'both callers get a successful attempt response');
  expect(calls.filter(call => call.action === 'attach').length === 1, 'one session attachment');
});

Deno.test('a resumed session waits for non-terminal failure and releases verified terminal failure', async () => {
  const pending = fixture('NOT CAPTURED', false);
  expect((await (await pending.handler(staff('check'))).json()).attempt.state === 'pending', 'non-terminal stays pending');
  expect(!pending.calls.some(call => call.action === 'failed'), 'no retry unlocked');
  const failed = fixture('NOT CAPTURED');
  expect((await (await failed.handler(staff('check'))).json()).attempt.state === 'failed', 'verified terminal failure');
});

Deno.test('webhook signature is required and capture is supported without a browser return', async () => {
  const { handler, calls } = fixture();
  const raw = JSON.stringify({ result: 'CAPTURED', track_id: track, requested_order_id: order });
  const denied = await handler(new Request(webhookUrl, { method: 'POST', body: raw }));
  expect(denied.status === 401 && !calls.length, 'untrusted webhook cannot change payment state');
  const stamp = String(Math.floor(Date.now() / 1000));
  const signature = await sign(secret, stamp + 'POST' + webhookUrl + raw);
  const accepted = await handler(new Request(webhookUrl, {
    method: 'POST', body: raw, headers: { 'x-timestamp': stamp, 'x-signature': signature },
  }));
  expect(accepted.ok && calls.length === 1 && calls[0].action === 'capture', 'independent verification');
  expect(JSON.stringify(calls[0].data).includes('25001'), 'verified fils from provider');
});
