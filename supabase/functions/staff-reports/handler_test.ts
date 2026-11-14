const assertEquals = (actual: unknown, expected: unknown) => { if (JSON.stringify(actual) !== JSON.stringify(expected)) throw Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); };
import { createReportHandler } from './handler.ts';

const origin = 'https://example.test';
Deno.test('report generation forwards only filters and caller token; work is retained in background', async () => {
  const calls: unknown[] = []; const tasks: Promise<unknown>[] = [];
  const handler = createReportHandler({ appUrl: origin, rpc: async (token, action, data) => { calls.push({ token, action, data }); return { id: 'test-id', state: action === 'create' ? 'queued' : 'ready' }; }, waitUntil: task => tasks.push(task) });
  const response = await handler(new Request(origin, { method: 'POST', headers: { Origin: origin, Authorization: 'Bearer caller-token' }, body: JSON.stringify({ preset: 'month', type: 'overview', owner_id: 'forged', actor_role: 'admin' }) }));
  assertEquals(response.status, 202); await Promise.all(tasks);
  assertEquals(calls, [{ token: 'caller-token', action: 'create', data: { type: 'overview', preset: 'month' } }, { token: 'caller-token', action: 'build', data: { id: 'test-id' } }]);
  assertEquals(response.headers.get('cache-control'), 'no-store');
});
Deno.test('report handler rejects foreign origins, missing authorization, bad JSON and oversized bodies', async () => {
  let calls = 0;
  const handler = createReportHandler({ appUrl: origin, rpc: async () => { calls++; return {}; }, waitUntil: () => {} });
  for (const [headers, body, status] of [
    [{ Origin: 'https://other.test', Authorization: 'Bearer t' }, '{}', 403],
    [{ Origin: origin }, '{}', 401],
    [{ Origin: origin, Authorization: 'Bearer t' }, '{', 400],
    [{ Origin: origin, Authorization: 'Bearer t' }, ' '.repeat(32769), 413],
  ] as const) {
    const response = await handler(new Request(origin, { method: 'POST', headers, body }));
    assertEquals(response.status, status);
  }
  assertEquals(calls, 0);
});
Deno.test('database authorization and quota failures remain failures, not zero reports', async () => {
  for (const [error, status] of [['REPORT_FORBIDDEN', 403], ['REPORT_RATE_LIMIT', 429]] as const) {
    const handler = createReportHandler({ appUrl: origin, rpc: async () => { throw Error(error); }, waitUntil: () => {} });
    const response = await handler(new Request(origin, { method: 'POST', headers: { Authorization: 'Bearer t' }, body: '{}' }));
    assertEquals(response.status, status); assertEquals(await response.json(), { error });
  }
});
Deno.test('background failure updates only its own job and does not cause unhandled rejection', async () => {
  const calls: string[] = []; const tasks: Promise<unknown>[] = [];
  const handler = createReportHandler({ appUrl: origin, rpc: async (_token, action) => { calls.push(action); if (action === 'build') throw Error('network failure'); return { id: 'test-id' }; }, waitUntil: task => tasks.push(task) });
  const response = await handler(new Request(origin, { method: 'POST', headers: { Authorization: 'Bearer t' }, body: '{}' }));
  await Promise.all(tasks); assertEquals(response.status, 202); assertEquals(calls, ['create', 'build', 'fail']);
});
