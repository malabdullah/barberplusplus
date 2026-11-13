import { createDeletionHandler, digest, receiptBox } from './handler.ts';
const assert = (value: unknown) => { if (!value) throw Error('Assertion failed'); };
const equal = (a: unknown, b: unknown) => assert(JSON.stringify(a) === JSON.stringify(b));
const origin = 'https://example.test';
const id = '8c43610f-3c44-4c96-bb21-99572d110f1f';
const receipt = 'a'.repeat(43);
const actor = { user_id: 'server-user', session_id: 'server-session' };
type Data = Record<string, unknown>;
function setup(overrides: Record<string, unknown> = {}) {
  const calls: { action: string; data?: Data }[] = []; const mails: unknown[][] = []; const tasks: Promise<void>[] = [];
  const handler = createDeletionHandler({ enabled: true, appUrl: origin, pepper: 'secret-test-pepper',
    identity: async token => token === 'valid' ? actor : null,
    rpc: async (action, data) => { calls.push({ action, data }); return {}; },
    mail: async (...args) => { mails.push(args); }, password: async () => false, process: async () => {}, retain: work => { tasks.push(work); }, ...overrides });
  const request = (value: unknown, token = 'valid') => handler(new Request(origin, { method: 'POST', headers: { Origin: origin, Authorization: `Bearer ${token}` }, body: JSON.stringify(value) }));
  return { handler, request, calls, mails, tasks };
}
Deno.test('deletion rejects hostile input before database or credential access', async () => {
  const { handler, calls, request } = setup();
  for (const value of [{ action: 'preview', user_id: 'victim' }, { action: 'start', id: '../x' }, { action: 'verify', id, receipt, code: '12' }, { action: 'confirm', id, receipt, digest: 'a'.repeat(64), confirmCancellation: false }]) equal((await request(value)).status, 400);
  for (const body of ['{', 'null', '[]', ' '.repeat(4097)]) equal((await handler(new Request(origin, { method: 'POST', body }))).status, 400);
  equal((await handler(new Request(origin, { method: 'POST', headers: { Origin: 'https://evil.test' }, body: '{}' }))).status, 403);
  equal((await request({ action: 'preview' }, 'expired')).status, 401); equal(calls.length, 0);
});
Deno.test('preview exposes only a masked verified destination and permitted methods', async () => {
  const { request } = setup({ rpc: async () => ({ email: 'private@example.test', hasPassword: false, userIds: ['secret'], customerIds: ['private'], providers: ['apple'], upcoming: [], upcomingCount: 0, hasMore: false, digest: 'x' }) });
  const response = await request({ action: 'preview' }); const data = await response.json();
  equal(data.destination, 'p***@example.test'); equal(data.methods, ['email_code']); equal(data.appleRevocation, 'manual_required');
  assert(!JSON.stringify(data).includes('private')); equal(response.headers.get('cache-control'), 'no-store');
});
Deno.test('start binds server identity and hashes proof; repeated start returns its stable receipt without another email', async () => {
  let stored: Data = {}; let count = 0; let sentCode = '';
  const { request, mails } = setup({ rpc: async (_action: string, data: Data) => { equal(data.user_id, actor.user_id); equal(data.session_id, actor.session_id); if (!count++) stored = data; return { created: count === 1, receiptBox: stored.receipt_box, email: 'qa@example.test', state: 'awaiting_code' }; }, mail: async (_email: string, code: string) => { sentCode = code; mails.push([code]); } });
  const first = await (await request({ action: 'start', id })).json(); const second = await (await request({ action: 'start', id })).json();
  equal(first.receipt, second.receipt); equal(stored.receipt_hash, await digest(first.receipt)); equal(mails.length, 1);
  assert(/^\d{6}$/.test(sentCode)); equal(stored.code_hash, await digest('secret-test-pepper:' + id + ':' + sentCode)); assert(!JSON.stringify(stored).includes(sentCode));
});
Deno.test('receipt encryption rejects tampering, wrong operation and wrong key', async () => {
  const box = await receiptBox('key', id, receipt); equal(await receiptBox('key', id, box, true), receipt); assert(!box.includes(receipt));
  for (const args of [['key', crypto.randomUUID(), box], ['other', id, box], ['key', id, box.slice(0, -4) + 'AAAA']]) {
    let rejected = false; try { await receiptBox(args[0], args[1], args[2], true); } catch { rejected = true; } assert(rejected);
  }
});
Deno.test('password validation cannot run until operation/session/receipt reservation passes', async () => {
  let attempts = 0;
  const { request } = setup({ rpc: async () => { throw Error('RECEIPT_INVALID'); }, password: async () => { attempts++; return true; } });
  equal((await request({ action: 'password', id, receipt, password: 'test' })).status, 400); equal(attempts, 0);
  const stopped = setup({ rpc: async () => ({ error: 'CODE_EXPIRED' }), password: async () => { attempts++; return true; } });
  equal((await stopped.request({ action: 'password', id, receipt, password: 'test' })).status, 400); equal(attempts, 0);
});
Deno.test('password proof is bound to its reserved attempt and server user', async () => {
  const calls: { action: string; data: Data }[] = [];
  const { request } = setup({ rpc: async (action: string, data: Data) => { calls.push({ action, data }); return action === 'password-check' ? { allowed: true } : { state: 'verified' }; }, password: async (user: string) => { equal(user, actor.user_id); return true; } });
  equal((await request({ action: 'password', id, receipt, password: 'test' })).status, 200);
  equal(calls.map(x => x.action), ['password-check', 'password-proof']); equal(calls[0].data.attempt, calls[1].data.attempt); equal(calls[1].data.verified, true); assert(!JSON.stringify(calls).includes('"password"'));
});
Deno.test('receipt-only status survives revoked authentication and retry retains bounded cleanup', async () => {
  let processed = ''; const { request, tasks } = setup({ rpc: async (_action: string, data: Data) => { assert(!data.user_id); equal(data.receipt_hash, await digest(receipt)); return { state: 'cleanup_pending' }; }, process: async (value: string) => { processed = value; } });
  equal((await request({ action: 'status', id, receipt }, '')).status, 202); equal(tasks.length, 0);
  equal((await request({ action: 'retry', id, receipt }, '')).status, 202); await Promise.all(tasks); equal(processed, id);
});
Deno.test('changed appointment preview requests review and cannot start cleanup', async () => {
  const { request, tasks } = setup({ rpc: async () => ({ state: 'review_required', upcoming: [{ id: 'changed' }] }) });
  const response = await request({ action: 'confirm', id, receipt, digest: 'a'.repeat(64), confirmCancellation: true }); equal(response.status, 200); equal((await response.json()).state, 'review_required'); equal(tasks.length, 0);
});
Deno.test('confirmed deletion retains cleanup after response and sends no booking email', async () => {
  const { request, tasks, mails } = setup({ rpc: async () => ({ state: 'cleanup_pending', cancelledCount: 2 }) });
  equal((await request({ action: 'confirm', id, receipt, digest: 'a'.repeat(64), confirmCancellation: true })).status, 202); equal(tasks.length, 1); await Promise.all(tasks); equal(mails.length, 0);
});
Deno.test('disabled deployment and failures do not leak backend details', async () => {
  equal((await setup({ enabled: false }).request({ action: 'preview' })).status, 503);
  const response = await setup({ rpc: async () => { throw Error('postgres password contact token'); } }).request({ action: 'preview' }); equal(await response.json(), { error: 'UNAVAILABLE' });
});
