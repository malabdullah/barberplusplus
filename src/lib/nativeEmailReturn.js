const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function nativeEmailReturn(input, config, deliveryToken) {
  const url = new URL(input); const hash = new URLSearchParams(url.hash.slice(1));
  if (url.searchParams.get('client') !== 'ios') return null;
  const scheme = config.environment === 'cloud-test' && config.appUrl === 'https://barber-test.alabdullah-cs.workers.dev' ? 'barberplusplus-test'
    : config.environment === 'production' && config.appUrl === 'https://www.barberplusplus.com' ? 'barberplusplus' : null;
  const state = url.searchParams.get('state'); const type = hash.get('type') || url.searchParams.get('type');
  const token = hash.get('token_hash') || url.searchParams.get('token_hash'); const request = url.searchParams.get('request_id');
  if (!scheme || url.origin !== new URL(config.appUrl).origin || !uuid.test(state || '') || !['signup', 'magiclink', 'recovery'].includes(type) || !/^[a-f0-9]{32,128}$/i.test(token || '') || (type === 'recovery' && !uuid.test(request || ''))) throw new Error('INVALID_CODE');
  const target = new URL(`${scheme}://email-callback`);
  if (type==='recovery') {
    if (!uuid.test(deliveryToken || '')) throw new Error('NATIVE_DELIVERY_REQUIRED');
    target.search=new URLSearchParams({state,type,request_id:request,delivery_token:deliveryToken}).toString();
  } else target.search = new URLSearchParams({ state, type, token_hash: token, ...(request ? { request_id: request } : {}) }).toString();
  return target.href;
}
