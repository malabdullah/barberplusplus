import { createAppleActions, createAppleProvider, type AppleConfiguration } from './apple.ts';
import { digest } from './handler.ts';
const check = (v: unknown) => { if (!v) throw Error('Assertion failed'); };
const same = (a: unknown, b: unknown) => check(JSON.stringify(a) === JSON.stringify(b));
const subject = '000123.synthetic-apple', nonce = 'synthetic_nonce_123456789';
const key = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1,0,1]), hash: 'SHA-256' }, true, ['sign','verify']);
const jwk = { ...await crypto.subtle.exportKey('jwk', key.publicKey), kid: 'test-key', use: 'sig', alg: 'RS256' };
const b64 = (v: Uint8Array) => btoa(String.fromCharCode(...v)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
const encode = (v: unknown) => b64(new TextEncoder().encode(JSON.stringify(v)));
const now = 1800000000000;
const config: AppleConfiguration = { enabled: true, clients: { ios: { clientId: 'com.barberplusplus.customer.test', clientSecret: 'synthetic-client-secret' }, web: { clientId: 'com.barberplusplus.authentication.test.web', clientSecret: 'synthetic-web-secret' } }, encryptionKey: 'a'.repeat(64), keyId: 'v1' };
async function jwt(body: Record<string, unknown> = {}, header: Record<string, unknown> = {}) {
  const data = encode({ alg: 'RS256', kid: 'test-key', ...header }) + '.' + encode({ iss: 'https://appleid.apple.com', aud: config.clients.ios!.clientId, sub: subject, iat: now/1000, exp: now/1000+300, nonce: await digest(nonce), ...body });
  return data + '.' + b64(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key.privateKey, new TextEncoder().encode(data))));
}
async function fails(work: () => Promise<unknown>, message: string) { try { await work(); } catch(e) { same((e as Error).message,message);return; } throw Error('Expected rejection'); }
async function setup(options: { claims?: Record<string, unknown>; responseClaims?: Record<string, unknown>; responseStatus?: number } = {}) {
  const requests: { url: string; body: URLSearchParams }[] = [];
  const idToken = await jwt(options.claims); const responseToken = await jwt(options.responseClaims);
  const fetcher: typeof fetch = async (url, init) => {
    check(String(url).startsWith('https://appleid.apple.com/auth/'));
    if (String(url).endsWith('/keys')) return Response.json({ keys: [jwk] });
    requests.push({ url: String(url), body: new URLSearchParams(String(init?.body)) });
    return String(url).endsWith('/revoke') ? new Response(null, { status: options.responseStatus || 200 }) : Response.json({ id_token: responseToken, refresh_token: 'synthetic-refresh-token' }, { status: options.responseStatus || 200 });
  };
  const provider = createAppleProvider(config, fetcher, () => now);
  return { requests, provider, input: { identityToken: idToken, rawNonce: nonce, authorizationCode: 'synthetic-one-use-code' } };
}
Deno.test('Apple registration encrypts validated token with owner/platform/subject binding and fixed endpoints', async () => {
  const { provider, input, requests } = await setup();
  const result = await provider.register('ios', input, subject, 'owner');
  check(!result.cipher.includes('synthetic-refresh-token'));same(result.key_id,'v1');
  await provider.revoke({ platform:'ios', user_id:'owner', subject, ...result });
  same(requests.map(r=>r.url),['https://appleid.apple.com/auth/token','https://appleid.apple.com/auth/revoke']);
  same(requests[0].body.get('grant_type'),'authorization_code');same(requests[1].body.get('token'),'synthetic-refresh-token');
  same(requests[1].body.get('client_id'),config.clients.ios!.clientId);
  await fails(()=>provider.revoke({ platform:'ios',user_id:'other',subject,...result }), 'APPLE_UNAVAILABLE');
});
Deno.test('invalid Apple subject, audience, nonce, issuer, age, expiry and algorithm fail before exchange', async () => {
  for (const claims of [{sub:'other'},{aud:'unreviewed-client'},{nonce:'wrong'},{iss:'https://evil.test'},{iat:now/1000-301},{exp:now/1000-1},{iat:now/1000+60}]) {
    const { provider, input, requests } = await setup({ claims });
    await fails(()=>provider.register('ios',input,subject,'owner'),'APPLE_PROOF_INVALID');same(requests.length,0);
  }
  const { provider,input }=await setup();input.identityToken=await jwt({}, {alg:'none'});
  await fails(()=>provider.register('ios',input,subject,'owner'),'APPLE_PROOF_INVALID');
});
Deno.test('exchanged Apple identity must also match; provider failures are generic', async () => {
  const first=await setup({responseClaims:{sub:'other'}});await fails(()=>first.provider.register('ios',first.input,subject,'owner'),'APPLE_PROOF_INVALID');
  const next=await setup({responseStatus:429});await fails(()=>next.provider.register('ios',next.input,subject,'owner'),'APPLE_UNAVAILABLE');same(next.requests.length,1);
});
Deno.test('web provider refresh token is validated with Apple without consuming OAuth code again', async () => {
  const {provider,requests}=await setup({responseClaims:{aud:config.clients.web!.clientId}});
  await provider.register('web',{providerRefreshToken:'web-refresh-token'},subject,'owner');
  same(requests.length,1);same(requests[0].body.get('grant_type'),'refresh_token');same(requests[0].body.has('code'),false);
});
Deno.test('capability guard, server-owned identity, replay reservation and store prevent unsafe registration', async () => {
  const {provider,input}=await setup();const calls: string[]=[];
  const actions=createAppleActions({provider,rpc:async (action,data)=>{calls.push(action);same(data.user_id,'owner');if(action==='apple-subject')return{subject,registered:false};if(action==='apple-reserve')return{attempt:'server-attempt'};check(typeof data.cipher==='string');same(data.attempt,'server-attempt');return{};}});
  const trusted={user_id:'owner',session_id:'live'};
  same(await actions('apple-status',{platform:'ios'},trusted),{available:true,registered:false,legacyManualFallback:true});
  same(await actions('apple-register',{platform:'ios',...input},trusted),{registered:true});
  same(calls.slice(-3),['apple-subject','apple-reserve','apple-store']);
  const blocked=createAppleActions({provider,rpc:async action=>{if(action==='apple-subject')return{subject};throw Error('APPLE_PROOF_INVALID');}});
  await fails(()=>blocked('apple-register',{platform:'ios',...input},trusted),'APPLE_PROOF_INVALID');
  await fails(()=>actions('apple-register',{platform:'web',providerRefreshToken:'x',...input},trusted),'INVALID_REQUEST');
});
Deno.test('revocation refuses unavailable credentials and wrong key version without provider access', async () => {
  const {provider,input}=await setup();const saved=await provider.register('ios',input,subject,'owner');
  await fails(()=>provider.revoke({...saved,platform:'ios',key_id:'v2'}),'APPLE_NOT_AVAILABLE');
  const disabled=createAppleProvider({...config,enabled:false},()=>{throw Error('must not fetch');});
  same(disabled.available('ios'),false);await fails(()=>disabled.revoke({...saved,platform:'ios'}),'APPLE_NOT_AVAILABLE');
});
