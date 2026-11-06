type Data = Record<string, unknown>;
type Dependencies = {
  secret: string;
  identity: (token: string) => Promise<{user_id: string; session_id: string} | null>;
  rpc: (action: string, data: Data) => Promise<unknown>;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const actions = new Set(['push-register','push-status','push-preferences','push-detach','push-guest-subscribe','push-guest-receipt']);
const decode = (s: string) => Uint8Array.from(atob(s.replaceAll('-','+').replaceAll('_','/')), c => c.charCodeAt(0));

export async function customerPushAction(deps: Dependencies, request: Request, body: Data) {
  const action = String(body.action);
  if (!actions.has(action) || !uuid.test(String(body.deviceId)) || typeof body.deviceSecret !== 'string'
    || !/^[0-9a-f]{64}$/.test(body.deviceSecret)) throw Error('INVALID_REQUEST');
  const bearer = request.headers.get('authorization')?.replace(/^Bearer /i,'') || '';
  const identity = bearer ? await deps.identity(bearer) : null;
  if (bearer && !identity) throw Error('AUTH_REQUIRED');
  const data: Data = {deviceId:body.deviceId,deviceSecret:body.deviceSecret,...identity};
  if (['push-register','push-detach'].includes(action)) {
    if (!Number.isSafeInteger(body.version) || Number(body.version)<1) throw Error('INVALID_REQUEST');
    data.version=body.version;
  }
  if (action==='push-register') {
    if (body.environment!=='sandbox' || typeof body.token!=='string' || !/^[0-9a-f]{32,512}$/.test(body.token)
      || body.token.length%2 || !['en','ar'].includes(String(body.language)) || typeof body.permission!=='boolean') throw Error('INVALID_REQUEST');
    Object.assign(data,{token:body.token,environment:body.environment,language:body.language,permission:body.permission});
  }
  if (action==='push-preferences') {
    const p=body.preferences as Data | null;
    const keys=['updates','reminder24','reminder2','reviews'];
    if (!p || typeof p!=='object' || Array.isArray(p) || Object.keys(p).length!==4 || keys.some(k=>typeof p[k]!=='boolean')) throw Error('INVALID_REQUEST');
    if (Object.hasOwn(body,'notificationsEnabled')) {
      if (typeof body.notificationsEnabled!=='boolean') throw Error('INVALID_REQUEST');
      data.notificationsEnabled=body.notificationsEnabled;
    }
    data.preferences=p;
  }
  if (action==='push-guest-subscribe') {
    if (typeof body.claimToken!=='string' || body.claimToken.length>3000) throw Error('FORBIDDEN');
    let proof: Data;
    try {
      const [payload,signature,extra]=body.claimToken.split('.');
      if (!payload || !signature || extra) throw Error();
      const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(`customer-booking-test-v1:${deps.secret}`),{name:'HMAC',hash:'SHA-256'},false,['verify']);
      if (!await crypto.subtle.verify('HMAC',key,decode(signature),new TextEncoder().encode(payload))) throw Error();
      proof=JSON.parse(new TextDecoder().decode(decode(payload)));
      if (proof.purpose!=='receipt' || proof.user_id || typeof proof.expires!=='number' || proof.expires<=Date.now()
        || !uuid.test(String(proof.id)) || typeof proof.phone!=='string' || typeof proof.country_code!=='string') throw Error();
    } catch { throw Error('FORBIDDEN'); }
    Object.assign(data,{bookingId:proof.id,receiptPhone:proof.phone,receiptCountry:proof.country_code});
  } else if (action==='push-guest-receipt') {
    if (!uuid.test(String(body.bookingId))) throw Error('INVALID_REQUEST');
    data.bookingId=body.bookingId;
  }
  return await deps.rpc(action,data);
}
