import {
  assertEncryptedWhatsAppFlowRequest,
  assertOutboundRecipientAllowed,
  getTrustedRole,
  hasValidSharedSecret,
} from './environment.ts';

Deno.test('staging WhatsApp Flow requests must be encrypted', () => {
  Deno.env.set('APP_ENV', 'staging');

  let rejected = false;
  try {
    assertEncryptedWhatsAppFlowRequest({ action: 'ping' });
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error('Expected plaintext Flow request to be rejected');

  assertEncryptedWhatsAppFlowRequest({
    encrypted_flow_data: 'encrypted-data',
    encrypted_aes_key: 'encrypted-key',
    initial_vector: 'initial-vector',
  });
});

Deno.test('development WhatsApp Flow requests may use plaintext fixtures', () => {
  Deno.env.set('APP_ENV', 'development');
  assertEncryptedWhatsAppFlowRequest({ action: 'ping' });
});

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

Deno.test('non-production outbound recipients require the allowlist', () => {
  Deno.env.set('APP_ENV', 'staging');
  Deno.env.set('OUTBOUND_RECIPIENT_ALLOWLIST', '96500000000');
  assertOutboundRecipientAllowed('+965 0000 0000');

  let rejected = false;
  try {
    assertOutboundRecipientAllowed('+965 1111 1111');
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error('Expected unlisted recipient to be rejected');
});
