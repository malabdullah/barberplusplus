export type AppEnvironment = 'development' | 'test' | 'production';

export function getRequiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing ${name} environment variable`);
  return value;
}

export function getAppEnvironment(): AppEnvironment {
  const value = getRequiredEnv('APP_ENV');
  if (value !== 'development' && value !== 'test' && value !== 'production') {
    throw new Error('APP_ENV must be development, test, or production');
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
