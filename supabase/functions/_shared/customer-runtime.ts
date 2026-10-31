import { createTestBoundary } from './test-boundary.ts';
type Configuration = { environment: string; appUrl: string; publicUrl: string; productionEnabled?: boolean; secret: string; cloudTestProjectRef?: string; cloudAccessKey?: string };

function origin(value: string): URL | null {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash ? url : null;
  } catch { return null; }
}
const loopback = (url: URL) => ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);

// Production activation is an explicit server setting. Local Test never accepts
// a remote backend, and production never accepts a loopback origin or Test code.
export function customerRuntime(config: Configuration) {
  const app = origin(config.appUrl);
  const api = origin(config.publicUrl);
  const localTest = ['development', 'test'].includes(config.environment) && !!app && !!api && loopback(app) && loopback(api);
  const production = config.environment === 'production' && config.productionEnabled === true && !!app && !!api && app.protocol === 'https:' && api.protocol === 'https:' && !loopback(app) && !loopback(api);
  const cloud = createTestBoundary(config);
  const cloudTest = config.environment === 'cloud-test' && cloud.enabled;
  const enabled = (localTest || production || cloudTest) && config.secret.length >= 32;
  return {
    enabled,
    localTest: enabled && localTest,
    async allows(req: Request) {
      return cloudTest ? enabled && await cloud.allows(req) : this.allowsOrigin(req.headers.get('origin'));
    },
    allowsOrigin(value: string | null) {
      if (!enabled || cloudTest) return false;
      if (!value) return true;
      const candidate = origin(value);
      if (!candidate) return false;
      return localTest ? loopback(candidate) && candidate.port === app!.port : candidate.origin === app!.origin;
    },
  };
}
