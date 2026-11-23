const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function nativeEmailReturn(input, config, deliveryToken) {
  const url = new URL(input); const hash = new URLSearchParams(url.hash.slice(1));
  if (url.searchParams.get('client') === 'android') {
    const authOrigin = config.environment === 'cloud-test' && config.appUrl === 'https://barber-test.alabdullah-cs.workers.dev'
      ? 'https://barber-auth-test.alabdullah-cs.workers.dev' : config.environment === 'production' && config.appUrl === 'https://www.barberplusplus.com'
        ? 'https://barber-auth.alabdullah-cs.workers.dev' : null;
    if (!authOrigin || url.origin !== config.appUrl || url.pathname !== '/customer/email-callback') throw new Error('INVALID_CODE');
    const entries = [...url.searchParams.entries()];
    if (new Set(entries.map(([key]) => key)).size !== entries.length
      || entries.some(([key]) => !['client', 'state', 'request_id', 'type', 'token_hash', 'next', 'native_fallback'].includes(key))
      || [...hash.keys()].some(key => !['type', 'token_hash'].includes(key))
      || new Set([...hash.keys()]).size !== [...hash.keys()].length) throw new Error('INVALID_CODE');
    if (url.searchParams.has('native_fallback')) {
      if (entries.length !== 2 || url.searchParams.get('native_fallback') !== '1' || url.hash) throw new Error('INVALID_CODE');
      throw new Error('ANDROID_NATIVE_FALLBACK');
    }
    const state = url.searchParams.get('state'), request = url.searchParams.get('request_id');
    if ((hash.has('type') && url.searchParams.has('type')) || (hash.has('token_hash') && url.searchParams.has('token_hash'))) throw new Error('INVALID_CODE');
    const type = hash.get('type') || url.searchParams.get('type');
    const token = hash.get('token_hash') || url.searchParams.get('token_hash');
    if (!uuid.test(state || '') || !uuid.test(request || '') || !['signup', 'recovery'].includes(type) || !/^[a-f0-9]{32,128}$/i.test(token || '')) throw new Error('INVALID_CODE');
    if (!uuid.test(deliveryToken || '')) throw new Error('NATIVE_DELIVERY_REQUIRED');
    const target = new URL('/auth/email', authOrigin);
    target.search = new URLSearchParams({ requestId: request, state, delivery: deliveryToken }).toString();
    return target.href;
  }
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
  } else {
    const hostname = config.environment === 'cloud-test'
      ? 'barber-open-test.alabdullah-cs.workers.dev' : 'barber-open.alabdullah-cs.workers.dev';
    const linked = new URL('https://' + hostname + '/auth/email');
    linked.search = new URLSearchParams({ client: 'ios', state }).toString();
    linked.hash = new URLSearchParams({ type, token_hash: token }).toString();
    return linked.href;
  }
  return target.href;
}
