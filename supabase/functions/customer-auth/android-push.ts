import { androidRuntime } from './android-runtime.ts';
type Data = Record<string, unknown>;
type Dependencies = {
  environment: string; appUrl: string; publicUrl: string; androidEnabled?: boolean;
  identity: (token: string) => Promise<{ user_id: string; session_id: string } | null>;
  rpc: (action: string, data: Data) => Promise<unknown>;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const actions = new Set(['push-register', 'push-status', 'push-preferences', 'push-detach']);
export async function androidPushAction(deps: Dependencies, request: Request, body: Data) {
  const runtime = androidRuntime(deps);
  if (!runtime || body.client !== 'android' || !actions.has(String(body.action))) throw Error('INVALID_REQUEST');
  if (!uuid.test(String(body.deviceId)) || typeof body.deviceSecret !== 'string' || !/^[0-9a-f]{64}$/.test(body.deviceSecret)) throw Error('INVALID_REQUEST');
  const bearer = request.headers.get('authorization')?.replace(/^Bearer /i, '') || '';
  const identity = bearer ? await deps.identity(bearer) : null;
  if ((bearer && !identity) || (body.action !== 'push-detach' && !identity)) throw Error('AUTH_REQUIRED');
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
