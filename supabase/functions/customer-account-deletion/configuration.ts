export const TEST_APP = 'https://barber-test.alabdullah-cs.workers.dev';
export const TEST_API = 'https://qvkucvcjmojjbphlzlks.supabase.co';
export const PRODUCTION_APP = 'https://www.barberplusplus.com';
export const PRODUCTION_API = 'https://srv1073968.hstgr.cloud';
export type DeletionConfiguration = {
  mode: 'test' | 'production' | 'disabled'; appUrl: string; publicUrl: string;
  functionUrl: string; enabled: boolean; newRequestsEnabled: boolean; cleanupEnabled: boolean;
};
type Input = { environment: string; appUrl: string; publicUrl: string; backendUrl: string;
  productionBackendUrl?: string; productionEnabled?: string; productionCleanupEnabled?: string; resendKey?: string };
export type RuntimeConfiguration = { deploymentEnvironment: string; testMode: boolean; functionUrl: string | null };
export function deletionConfiguration(input: Input): DeletionConfiguration {
  const disabled: DeletionConfiguration = { mode: 'disabled', appUrl: input.appUrl, publicUrl: input.publicUrl, functionUrl: '', enabled: false, newRequestsEnabled: false, cleanupEnabled: false };
  if (input.environment === 'cloud-test' && input.appUrl === TEST_APP && input.publicUrl === TEST_API && input.backendUrl === TEST_API) {
    return { mode: 'test', appUrl: TEST_APP, publicUrl: TEST_API, functionUrl: TEST_API + '/functions/v1/customer-account-deletion', enabled: true, newRequestsEnabled: true, cleanupEnabled: true };
  }
  // The external API is pinned. The internal endpoint must be explicitly bound
  // during release preparation; copying Test credentials cannot enable Live.
  if (input.environment !== 'production' || input.appUrl !== PRODUCTION_APP || input.publicUrl !== PRODUCTION_API
    || input.backendUrl !== input.productionBackendUrl || ![PRODUCTION_API, 'http://kong:8000', 'http://api-gw:8000'].includes(input.backendUrl)) return disabled;
  const cleanupEnabled = input.productionCleanupEnabled === 'true';
  const newRequestsEnabled = input.productionEnabled === 'true' && cleanupEnabled && Boolean(input.resendKey?.trim());
  return { mode: 'production', appUrl: PRODUCTION_APP, publicUrl: PRODUCTION_API,
    functionUrl: PRODUCTION_API + '/functions/v1/customer-account-deletion', enabled: cleanupEnabled,
    newRequestsEnabled, cleanupEnabled };
}
export function deletionRuntimeMatches(config: DeletionConfiguration, runtime: RuntimeConfiguration | null): boolean {
  return config.enabled && !!runtime && runtime.functionUrl === config.functionUrl
    && (config.mode === 'test' ? runtime.deploymentEnvironment === 'cloud-test' && runtime.testMode === true
      : config.mode === 'production' && runtime.deploymentEnvironment === 'production' && runtime.testMode === false);
}
export function withDeletionActivation(config: DeletionConfiguration, runtime: () => Promise<RuntimeConfiguration | null>, handler: (req: Request) => Promise<Response>) {
  return async (req: Request) => {
    const unavailable = () => Response.json({ error: 'NOT_ENABLED' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    if (!config.enabled) return unavailable();
    try { if (!deletionRuntimeMatches(config, await runtime())) return unavailable(); }
    catch { return unavailable(); }
    return handler(req);
  };
}
