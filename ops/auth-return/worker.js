import { createAuthReturnWorker } from './core.js';
import associations from './associations.live.json' with { type: 'json' };
export const AUTH_ORIGIN = 'https://barber-auth.alabdullah-cs.workers.dev';
export const APP_ORIGIN = 'https://www.barberplusplus.com';
export default createAuthReturnWorker({ origin: AUTH_ORIGIN, appOrigin: APP_ORIGIN,
  packageName: associations.androidPackage, fingerprints: associations.androidSha256 });
