const ENVIRONMENTS = new Set(['development', 'test', 'staging', 'production']);
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

const normalizeOrigin = (value, label, environment) => {
  if (!value || typeof value !== 'string') {
    throw new Error(`Missing ${label}.`);
  }

  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error(`${label} must be a valid URL.`);
  }

  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`${label} must be an origin without credentials, a path, query, or fragment.`);
  }

  const isLoopback = LOOPBACK_HOSTS.has(url.hostname);
  if (environment === 'development' || environment === 'test') {
    if (!isLoopback) {
      throw new Error(`${label} must use a loopback host during local development.`);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error(`${label} must use HTTP or HTTPS.`);
    }
  } else if (url.protocol !== 'https:') {
    throw new Error(`${label} must use HTTPS outside local development.`);
  }

  return url.origin;
};

const validatePublishableKey = (value) => {
  if (!value || typeof value !== 'string') {
    throw new Error('Missing Supabase publishable key.');
  }

  const key = value.trim();
  if (key.startsWith('sb_publishable_')) return key;

  try {
    const [, encodedPayload, signature] = key.split('.');
    if (!encodedPayload || !signature) throw new Error('Malformed JWT');

    const normalizedPayload = encodedPayload.replace(/-/g, '+').replace(/_/g, '/');
    const paddedPayload = normalizedPayload.padEnd(Math.ceil(normalizedPayload.length / 4) * 4, '=');
    const payload = JSON.parse(atob(paddedPayload));

    if (payload.role === 'anon') return key;
  } catch {
    // Use the safe configuration error below.
  }

  throw new Error('Supabase key must be an sb_publishable_ key or a legacy anon-role JWT.');
};

export const validateRuntimeConfig = (rawConfig) => {
  const environment = rawConfig?.environment?.trim();
  if (!ENVIRONMENTS.has(environment)) {
    throw new Error('APP_ENV must be development, test, staging, or production.');
  }

  return Object.freeze({
    environment,
    appUrl: normalizeOrigin(rawConfig.appUrl, 'Application URL', environment),
    supabaseUrl: normalizeOrigin(rawConfig.supabaseUrl, 'Supabase URL', environment),
    supabasePublishableKey: validatePublishableKey(rawConfig.supabasePublishableKey),
    release: typeof rawConfig.release === 'string' && rawConfig.release.trim()
      ? rawConfig.release.trim()
      : 'local',
  });
};
