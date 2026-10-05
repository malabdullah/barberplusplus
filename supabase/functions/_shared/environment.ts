export type AppEnvironment = 'development' | 'staging' | 'production';

export function getRequiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing ${name} environment variable`);
  return value;
}

export function getAppEnvironment(): AppEnvironment {
  const value = getRequiredEnv('APP_ENV');
  if (value !== 'development' && value !== 'staging' && value !== 'production') {
    throw new Error('APP_ENV must be development, staging, or production');
  }
  return value;
}

export function getAppUrl(): string {
  const value = getRequiredEnv('APP_URL');
  const url = new URL(value);
  const isLocal = url.hostname === '127.0.0.1' || url.hostname === 'localhost';

  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('APP_URL must be an origin without credentials, path, query, or fragment');
  }
  if (!isLocal && url.protocol !== 'https:') {
    throw new Error('APP_URL must use HTTPS outside local development');
  }
  return url.origin;
}

export function getTrustedRole(user: { app_metadata?: Record<string, unknown> }): string | null {
  const role = user.app_metadata?.role;
  return typeof role === 'string' ? role.toLowerCase() : null;
}

export function assertOutboundRecipientAllowed(recipient: string): void {
  if (getAppEnvironment() === 'production') return;

  const allowlist = getRequiredEnv('OUTBOUND_RECIPIENT_ALLOWLIST')
    .split(',')
    .map((value) => value.replace(/\D/g, ''))
    .filter(Boolean);
  const normalizedRecipient = recipient.replace(/\D/g, '');

  if (!allowlist.includes(normalizedRecipient)) {
    throw new Error('Outbound recipient is not allowed in this environment');
  }
}

export async function hasValidSharedSecret(req: Request, headerName = 'x-cron-secret'): Promise<boolean> {
  const expected = Deno.env.get('CRON_SHARED_SECRET');
  const supplied = req.headers.get(headerName);
  if (!expected || !supplied) return false;

  const encoder = new TextEncoder();
  const [expectedHash, suppliedHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
    crypto.subtle.digest('SHA-256', encoder.encode(supplied)),
  ]);
  const expectedBytes = new Uint8Array(expectedHash);
  const suppliedBytes = new Uint8Array(suppliedHash);
  if (expectedBytes.length !== suppliedBytes.length) return false;

  let difference = 0;
  for (let index = 0; index < expectedBytes.length; index += 1) {
    difference |= expectedBytes[index] ^ suppliedBytes[index];
  }
  return difference === 0;
}

export function assertEncryptedWhatsAppFlowRequest(body: Record<string, unknown>): void {
  const hasEncryptedPayload =
    typeof body.encrypted_flow_data === 'string' && body.encrypted_flow_data.length > 0 &&
    typeof body.encrypted_aes_key === 'string' && body.encrypted_aes_key.length > 0 &&
    typeof body.initial_vector === 'string' && body.initial_vector.length > 0;

  if (!hasEncryptedPayload && getAppEnvironment() !== 'development') {
    throw new Error('Unencrypted WhatsApp Flow requests are disabled outside development');
  }
}
