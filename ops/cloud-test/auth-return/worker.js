import { createAuthReturnWorker, validAuthReturn as validate } from '../../auth-return/core.js';
import associations from './associations.json' with { type: 'json' };
export const AUTH_ORIGIN = 'https://barber-auth-test.alabdullah-cs.workers.dev';
export const TEST_ORIGIN = 'https://barber-test.alabdullah-cs.workers.dev';
export const validAuthReturn = url => validate(url, AUTH_ORIGIN);
export default createAuthReturnWorker({ origin: AUTH_ORIGIN, appOrigin: TEST_ORIGIN,
  packageName: associations.androidPackage, fingerprints: associations.androidSha256 });
