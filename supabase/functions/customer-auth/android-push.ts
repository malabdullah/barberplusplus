import { androidDeployment, androidRuntime } from './android-runtime.ts';
type Data = Record<string, unknown>;
type Dependencies = {
  environment: string; appUrl: string; publicUrl: string; androidEnabled?: boolean; androidPushEnrollmentScope?: string;
  identity: (token: string) => Promise<{ user_id: string; session_id: string } | null>;
  rpc: (action: string, data: Data) => Promise<unknown>;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const actions = new Set(['push-register', 'push-status', 'push-preferences', 'push-detach']);
// This operator-supplied scope is an additional HTTP gate. The database still
// enforces its independent grant and checks the authenticated customer session.
function enrollmentScope(raw: string | undefined) {
  if (!raw || raw.length > 1024) return null;
  try {
    const scope = JSON.parse(raw);
    if (!scope || !uuid.test(scope.userId) || !uuid.test(scope.deviceId)
      || !/^[0-9a-f]{64}$/.test(scope.secretHash)
      || !Number.isSafeInteger(scope.startsAtMs) || !Number.isSafeInteger(scope.expiresAtMs)
      || scope.expiresAtMs - scope.startsAtMs > 600_000
      || Date.now() < scope.startsAtMs || Date.now() >= scope.expiresAtMs) return null;
    return scope as { userId: string; deviceId: string; secretHash: string; expiresAtMs: number };
  } catch { return null; }
}

export async function androidPushAction(deps: Dependencies, request: Request, body: Data) {
  const general = androidRuntime(deps);
  const scope = !general && deps.environment === 'production'
    && (body.action === 'push-register' || body.action === 'push-status')
    ? enrollmentScope(deps.androidPushEnrollmentScope) : null;
  const runtime = general ?? (scope && androidDeployment(deps));
  if (!runtime || body.client !== 'android' || !actions.has(String(body.action))) throw Error('INVALID_REQUEST');
  if (!uuid.test(String(body.deviceId)) || typeof body.deviceSecret !== 'string' || !/^[0-9a-f]{64}$/.test(body.deviceSecret)) throw Error('INVALID_REQUEST');
  const bearer = request.headers.get('authorization')?.replace(/^Bearer /i, '') || '';
  const identity = bearer ? await deps.identity(bearer) : null;
  if ((bearer && !identity) || (body.action !== 'push-detach' && !identity)) throw Error('AUTH_REQUIRED');
  if (scope) {
    if (identity?.user_id !== scope.userId || body.deviceId !== scope.deviceId) throw Error('FORBIDDEN');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body.deviceSecret));
    const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    if (hash !== scope.secretHash || Date.now() >= scope.expiresAtMs) throw Error('FORBIDDEN');
  }
  const data: Data = { deviceId: body.deviceId, deviceSecret: body.deviceSecret, ...identity };
  if (['push-register', 'push-detach'].includes(String(body.action))) {
    if (!Number.isSafeInteger(body.version) || Number(body.version) < 1) throw Error('INVALID_REQUEST');
    data.version = body.version;
  }
  if (body.action === 'push-register') {
    if (body.provider !== 'fcm' || body.projectId !== runtime.projectId
      || body.packageName !== runtime.packageName || typeof body.token !== 'string'
      || !/^[A-Za-z0-9_:-]{20,4096}$/.test(body.token) || !['en', 'ar'].includes(String(body.language))
      || typeof body.permission !== 'boolean') throw Error('INVALID_REQUEST');
    Object.assign(data, { token: body.token, projectId: body.projectId, packageName: body.packageName,
      language: body.language, permission: body.permission });
  }
  if (body.action === 'push-preferences') {
    const p = body.preferences as Data | null;
    const keys = ['updates', 'reminder24', 'reminder2', 'reviews'];
    if (!p || typeof p !== 'object' || Array.isArray(p) || Object.keys(p).length !== 4 || keys.some(key => typeof p[key] !== 'boolean')) throw Error('INVALID_REQUEST');
    data.preferences = p;
    if (Object.hasOwn(body, 'notificationsEnabled')) {
      if (typeof body.notificationsEnabled !== 'boolean') throw Error('INVALID_REQUEST');
      data.notificationsEnabled = body.notificationsEnabled;
    }
  }
  return await deps.rpc(`android-${String(body.action)}`, data);
}
