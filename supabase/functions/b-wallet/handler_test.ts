import { strict as assert } from 'node:assert';
import { createWalletHandler, walletProject, walletSite } from './handler.ts';
import { sign } from '../_shared/upayments-sandbox.ts';

const id = '10000000-0000-4000-8000-000000000001';
const order = id.replaceAll('-', '');
const endpoint = walletProject + '/functions/v1/b-wallet';
const callback = endpoint + '/webhook/' + order;
const secret = 'unit-test-secret';
const identity = { user_id: id, session_id: id };
const exampleSession = 'example_session_001';

Deno.test('wallet checkout is gated and only creates a charge for a new valid signed-in intent', async () => {
  let starts = 0;
  let charges = 0;
  const handler = createWalletHandler({
    token: 'unit-test-token', secret, allows: req => Promise.resolve(req.headers.get('x-test') === 'allowed'),
    identify: token => Promise.resolve(token === 'signed-in' ? identity : null),
    rpc: (action, _id, data) => {
      if (action === 'start') {
        assert.equal(data.amount_fils, 1250);
        return Promise.resolve({ id, state: 'creating', amountFils: '1250', create: ++starts === 1 });
      }
      assert.equal(action, 'attach');
      return Promise.resolve({ id,state: 'pending', checkoutUrl: data.checkout_url });
    },
    fetcher: (_url, init) => {
      charges++;
      const request = JSON.parse(String(init?.body));
      assert.equal(request.order.amount, 1.25);
      assert.equal(request.notificationUrl, callback);
      return Promise.resolve(Response.json({ status: true, data: {
        link: 'https://sandbox.upayments.com/pay?session_id=' + exampleSession,
      } }, { status: 201 }));
    },
  });
  const call = (amountFils: number, headers: Record<string,string>) => handler(new Request(walletSite, {
    method: 'POST', headers, body: JSON.stringify({ action: 'start', id, amountFils }),
  }));
  assert.equal((await call(1250, {})).status, 403);
  assert.equal((await call(1250, { 'x-test': 'allowed' })).status, 401);
  const headers = { 'x-test':'allowed', Authorization:'Bearer signed-in' };
  assert.equal((await call(12.5, headers)).status, 400);
  assert.equal((await (await call(1250, headers)).json()).topup.state, 'pending');
  assert.equal((await call(1250, headers)).status, 200);
  assert.equal(charges, 1);
});

Deno.test('wallet callback ignores the supplied status and verifies the provider transaction', async () => {
  let captures = 0;
  let credited = false;
  let providerAmount: number | string = '1.250';
  const handler = createWalletHandler({
    token: 'unit-test-token', secret, allows: () => Promise.resolve(false), identify: () => Promise.resolve(null),
    rpc: (action, attempt, data) => {
      assert.equal(attempt, id);
      if (action === 'reconcile') return Promise.resolve({ state: credited ? 'credited' : 'review', sessionId: exampleSession });
      assert.equal(action, 'capture');
      assert.equal(data.amount_fils, 1250);
      captures++;
      credited = true;
      return Promise.resolve(null);
    },
    fetcher: (url) => {
      assert.equal(new URL(String(url)).searchParams.get('session_id'), exampleSession);
      return Promise.resolve(Response.json({ status: true, data: { transaction: {
        merchant_requested_order_id: order, reference: order, notify_url: callback, result:'CAPTURED',
        isTerminalStatus: true, total_paid_non_kwd: providerAmount, currency_type:'KWD',
        track_id:'example_tracking_01', order_id:'example_order_0001',
      } } }, { status: 201 }));
    },
  });
  const raw = '{"result":"FAILED"}';
  const stamp = String(Math.floor(Date.now() / 1000));
  const headers = { 'x-timestamp': stamp, 'x-signature': await sign(secret, stamp + 'POST' + callback + raw) };
  assert.equal((await handler(new Request(callback, { method:'POST', body:raw }))).status, 401);
  providerAmount = 'invalid';
  assert.equal((await handler(new Request(callback, { method:'POST', body:raw, headers }))).status, 503);
  providerAmount = 1.25;
  assert.equal((await handler(new Request(callback, { method:'POST', body:raw, headers }))).status, 204);
  assert.equal((await handler(new Request(callback, { method:'POST', body:raw, headers }))).status, 204);
  assert.equal(captures, 1);
});

Deno.test('expired wallet link stays unresolved until a bound terminal non-capture', async () => {
  let state = 'review';
  let terminal: boolean | undefined;
  let reference = order;
  let charges = 0;
  const handler = createWalletHandler({
    token: 'unit-test-token', secret, allows: () => Promise.resolve(true),
    identify: () => Promise.resolve(identity),
    rpc: (action, _id, data) => {
      if (action === 'read' || action === 'latest') {
        return Promise.resolve({ id, state, amountFils: '1250', checkoutUrl: null, linkExpired: state === 'review' });
      }
      if (action === 'reconcile') return Promise.resolve({ state, sessionId: exampleSession });
      if (action === 'start') return Promise.resolve({ id, state, amountFils: '1250' });
      assert.equal(action, 'fail');
      assert.equal(data.session_id, exampleSession);
      state = 'failed';
      return Promise.resolve(null);
    },
    fetcher: (url, init) => {
      if (init?.method === 'POST') charges++;
      assert.equal(init?.method, 'GET');
      assert.equal(new URL(String(url)).searchParams.get('session_id'), exampleSession);
      return Promise.resolve(Response.json({ status: true, data: { transaction: {
        merchant_requested_order_id: order, reference, notify_url: callback, result: 'NOT CAPTURED',
        status: terminal ? 'done' : 'PENDING', isTerminalStatus: terminal, total_paid_non_kwd: '1.250',
      } } }, { status: 201 }));
    },
  });
  const call = (action: string) => handler(new Request(walletSite, {
    method: 'POST', body: JSON.stringify({
      action, id: action === 'start' ? '10000000-0000-4000-8000-000000000002' : id, amountFils: 1250,
    }),
  }));
  const { topup } = await (await call('check')).json();
  assert.deepEqual(topup, { id, state: 'review', amountFils: '1250', checkoutUrl: null, linkExpired: true });
  assert.equal((await (await call('start')).json()).topup.id, id);
  assert.equal(charges, 0);

  terminal = true;
  reference = 'different-order';
  assert.equal((await call('check')).status, 503);
  assert.equal(state, 'review');

  reference = order;
  const result = await call('check');
  assert.equal(result.status, 200);
  assert.equal((await result.json()).topup.state, 'failed');
  assert.equal(charges, 0);
});
