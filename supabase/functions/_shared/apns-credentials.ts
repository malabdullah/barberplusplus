export type APNsCredential = {
  privateKey: string; keyId: string; teamId: string;
  environment: string; topic: string; apiUrl: string;
};
export type APNsConfiguration = {
  apiUrl: string; topic: string; environments: string[];
  privateKey?: string; keyId?: string; teamId?: string;
  credentials?: Record<string, unknown>;
};
function validKey(value: unknown): value is Pick<APNsCredential, 'privateKey' | 'keyId' | 'teamId'> & Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const key = value as Record<string, unknown>;
  return typeof key.privateKey === 'string' && key.privateKey.length <= 16384 &&
    /^-----BEGIN PRIVATE KEY-----\s+[A-Za-z0-9+/=\s]+\s+-----END PRIVATE KEY-----\s*$/.test(key.privateKey) &&
    typeof key.keyId === 'string' && /^[A-Z0-9]{10}$/.test(key.keyId) &&
    typeof key.teamId === 'string' && /^[A-Z0-9]{10}$/.test(key.teamId);
}
// Legacy Vault configuration represents the existing sandbox key only. An
// absent or malformed production credential must never inherit that key.
export function apnsCredential(config: APNsConfiguration, environment: string): APNsCredential | null {
  if (!['sandbox', 'production'].includes(environment) || !config.environments.includes(environment)) return null;
  if (config.credentials && Object.hasOwn(config.credentials, environment)) {
    const key = config.credentials[environment];
    if (!validKey(key) || key.environment !== environment || key.topic !== config.topic || key.apiUrl !== config.apiUrl) return null;
    if (config.teamId && key.teamId !== config.teamId) return null;
    if (environment === 'production' &&
      (key.keyId === config.keyId || key.keyId === (config.credentials.sandbox as Record<string, unknown> | undefined)?.keyId)) return null;
    return key as APNsCredential;
  }
  if (environment !== 'sandbox' || !validKey(config)) return null;
  return { privateKey: config.privateKey, keyId: config.keyId, teamId: config.teamId,
    environment, topic: config.topic, apiUrl: config.apiUrl };
}
export function hasAPNsCredential(config: APNsConfiguration) {
  return config.environments.some(environment => apnsCredential(config, environment) !== null);
}
export function apnsTokenSelector(config: APNsConfiguration, mint: (key: APNsCredential) => Promise<string>) {
  const tokens = new Map<string, Promise<string | null>>();
  return (environment: string): Promise<string | null> => {
    const key = apnsCredential(config, environment);
    if (!key) return Promise.resolve(null);
    if (!tokens.has(environment)) tokens.set(environment, Promise.resolve().then(() => mint(key)).catch(() => null));
    return tokens.get(environment)!;
  };
}
