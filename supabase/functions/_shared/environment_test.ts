import {
  getTrustedRole,
  hasValidSharedSecret,
} from './environment.ts';

Deno.test('trusted role is read only from app_metadata', () => {
  const role = getTrustedRole({ app_metadata: { role: 'BARBER' } });
  if (role !== 'barber') throw new Error('Expected normalized trusted role');
});

Deno.test('cron shared secret uses the dedicated header', async () => {
  Deno.env.set('CRON_SHARED_SECRET', 'test-cron-secret');
  const request = new Request('http://127.0.0.1', {
    headers: { 'x-cron-secret': 'test-cron-secret' },
  });
  if (!(await hasValidSharedSecret(request))) throw new Error('Expected valid cron secret');
});
