// Serialized into the existing isolated Storage/Node container. No host ports,
// SDK downloads, external credentials or additional client service are needed.
export async function fullStackClient(settings, privateStorageDenied) {
  const { createHmac, randomBytes, publicEncrypt, createCipheriv, createDecipheriv } = await import('node:crypto');
  const { setTimeout: delay } = await import('node:timers/promises');
  const check = (ok, label) => { if (!ok) throw new Error(`FULLSTACK_ASSERT:${label}`); };
  const origin = 'https://staging-barber.malabdullah.cloud';
  const call = (path, init = {}) => fetch('http://api-gw:8000' + path,
    { ...init, signal: AbortSignal.timeout(45000) });
  let ready = false;
  for (let i = 0; i < 80; i++) {
    try { if ((await call('/auth/v1/health', { headers: { apikey: settings.anon } })).status === 200) { ready = true; break; } } catch { /* startup */ }
    await delay(250);
  }
  check(ready, 'gateway readiness');
  check((await call('/rest/v1/branches')).status === 401, 'gateway missing API key');
  const login = await call('/auth/v1/token?grant_type=password', { method: 'POST',
    headers: { apikey: settings.anon, 'content-type': 'application/json', origin },
    body: JSON.stringify({ email: 'admin@barber.test', password: settings.password }) });
  check(login.status === 200, 'gateway Auth login');
  check(login.headers.get('access-control-allow-origin') === origin, 'Auth exact CORS');
  const session = await login.json();
  check(session.user.app_metadata.role === 'admin' && !!session.access_token, 'Auth role and JWT');
  const jwt = { apikey: settings.anon, authorization: `Bearer ${session.access_token}`, origin };
  const branches = await call('/rest/v1/branches?select=id&limit=1', { headers: jwt });
  check(branches.status === 200 && (await branches.json()).length === 1, 'gateway REST authenticated read');
  const anonymous = await call('/rest/v1/branches?select=id&limit=1', { headers: { apikey: settings.anon } });
  // The application revokes anonymous execution of policy role helpers.
  // Expect the explicit PostgreSQL insufficient-privilege denial, not an empty
  // success response (and never accept an arbitrary failure as authorization).
  check([401, 403].includes(anonymous.status) && (await anonymous.json()).code === '42501', 'REST anonymous authorization denial');
  const barberLogin = await call('/auth/v1/token?grant_type=password', { method: 'POST',
    headers: { apikey: settings.anon, 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'barber@barber.test', password: settings.barberPassword }) });
  check(barberLogin.status === 200, 'gateway barber login');
  const barber = await barberLogin.json();
  const barberHeaders = { apikey: settings.anon, authorization: `Bearer ${barber.access_token}` };
  const own = await call('/rest/v1/branches?select=id&id=eq.10000000-0000-4000-8000-000000000001', { headers: barberHeaders });
  const other = await call('/rest/v1/branches?select=id&id=eq.10000000-0000-4000-8000-000000000002', { headers: barberHeaders });
  check(own.status === 200 && (await own.json()).length === 1, 'gateway REST own branch');
  check(other.status === 200 && (await other.json()).length === 0, 'gateway REST cross tenant denial');
  const service = { apikey: settings.key, authorization: `Bearer ${settings.key}` };
  const path = '/storage/v1/object/authenticated/synthetic-probe/check.txt';
  const stored = await call(path, { headers: { ...service, origin } });
  check(stored.status === 200 && await stored.text() === 'synthetic-only', 'gateway Storage download');
  check(stored.headers.get('access-control-allow-origin') === origin, 'Storage exact CORS');
  const uploaded = await call('/storage/v1/object/synthetic-probe/gateway.txt', {
    method: 'POST', headers: { ...service, 'content-type': 'text/plain' }, body: 'synthetic-gateway-only' });
  check(uploaded.status === 200, 'gateway Storage upload');
  const denied = await call(path, { headers: { apikey: settings.anon, authorization: `Bearer ${settings.anon}` } });
  const deniedBody = await denied.json();
  check(privateStorageDenied(denied.status, deniedBody), 'gateway Storage anonymous denial');
  const preflight = await call('/storage/v1/object/synthetic-probe/gateway.txt', { method: 'OPTIONS', headers: {
    origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'apikey,authorization,content-type' } });
  check(preflight.status === 200 && preflight.headers.get('access-control-allow-origin') === origin, 'real gateway preflight');
  check(!preflight.headers.has('access-control-allow-credentials'), 'no credential CORS');
  for (const route of ['/auth/v1/user', '/rest/v1/branches', path, '/functions/v1/get-kuwait-governorates']) {
    const response = await call(route, { headers: { ...jwt, origin: 'https://hostile.invalid' } });
    check(response.status === 403 && !response.headers.has('access-control-allow-origin'), 'hostile Origin denied');
  }
  for (const route of ['/pg/tables', '/mcp', '/api/mcp', '/realtime/v1/api/tenants']) {
    check((await call(route, { headers: service })).status === 403, 'management route denied');
  }
  console.log('FULLSTACK_PASS: gateway Auth REST Storage and boundaries');

  const fn = (name, init) => call(`/functions/v1/${name}`, init);
  for (const name of ['main', 'get-kuwait-governorates/', 'whatsapp-webhook/child', 'whatsapp-flow-endpoint/child']) {
    check((await fn(name)).status === 404, 'Functions exact paths');
  }
  check((await fn('get-kuwait-governorates')).status === 401, 'Functions missing JWT');
  check((await fn('get-kuwait-governorates', { headers: { authorization: 'Bearer invalid' } })).status === 401, 'Functions invalid JWT');
  for (const name of ['cleanup-notifications', 'send-booking-reminders']) {
    check((await fn(name, { method: 'POST', headers: { 'x-cron-secret': 'wrong-synthetic-value' } })).status === 401, 'Functions cron denial');
  }
  const gov = await fn('get-kuwait-governorates?areas=false', { headers: jwt });
  const govData = await gov.json();
  check(gov.status === 200 && govData.count === 1 && govData.data[0].id === 9001, 'Functions real governorates database worker');
  check(gov.headers.get('access-control-allow-origin') === origin && !gov.headers.has('access-control-allow-credentials'), 'Functions gateway CORS');
  check((await fn('auth-rate-limiter', { headers: jwt })).status === 405, 'rate limiter worker');
  check((await fn('invite-barber', { method: 'POST', headers: jwt, body: 'x'.repeat(10241) })).status === 413, 'invite worker input limit');
  const send = await fn('send-whatsapp-message', { method: 'POST', headers: jwt, body: '{}' });
  check(send.status === 500 && (await send.json()).error === 'Missing WhatsApp API configuration', 'outbound integration disabled');
  for (const name of ['whatsapp-webhook', 'whatsapp-flow-endpoint']) {
    check((await fn(name, { method: 'POST', body: '{}' })).status === 401, 'Meta missing signature');
    check((await fn(name, { method: 'POST', headers: { 'x-hub-signature-256': 'sha256=' + '0'.repeat(64) }, body: '{}' })).status === 401, 'Meta invalid signature');
  }
  const challenge = await fn(`whatsapp-webhook?hub.mode=subscribe&hub.verify_token=${settings.verify}&hub.challenge=synthetic-gateway`);
  check(challenge.status === 200 && await challenge.text() === 'synthetic-gateway', 'Meta verified challenge');
  const sign = (body) => ({ 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=' + createHmac('sha256', settings.meta).update(body).digest('hex') });
  const empty = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });
  check((await fn('whatsapp-webhook', { method: 'POST', headers: sign(empty), body: empty })).status === 200, 'Meta authenticated raw body');
  check((await fn('whatsapp-webhook', { method: 'POST', headers: sign(empty), body: empty + ' ' })).status === 401, 'Meta changed body denied');
  check((await fn('whatsapp-flow-endpoint')).status === 405, 'remote Flow GET disabled');
  const plain = JSON.stringify({ action: 'ping' });
  const plainResponse = await fn('whatsapp-flow-endpoint', { method: 'POST', headers: sign(plain), body: plain });
  check(plainResponse.status === 200 && (await plainResponse.text()).includes('encrypted'), 'Flow plaintext refused');
  const aes = randomBytes(16); const iv = randomBytes(12);
  const cipher = createCipheriv('aes-128-gcm', aes, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify({ version: '3.0', action: 'ping' })), cipher.final(), cipher.getAuthTag()]);
  const payload = JSON.stringify({ encrypted_flow_data: encrypted.toString('base64'),
    encrypted_aes_key: publicEncrypt({ key: settings.flowPublic, oaepHash: 'sha256' }, aes).toString('base64'), initial_vector: iv.toString('base64') });
  const ping = await fn('whatsapp-flow-endpoint', { method: 'POST', headers: sign(payload), body: payload });
  check(ping.status === 200, 'encrypted Flow status');
  const answer = Buffer.from(await ping.text(), 'base64');
  const decipher = createDecipheriv('aes-128-gcm', aes, iv.map((byte) => byte ^ 255));
  decipher.setAuthTag(answer.subarray(-16));
  const recovered = JSON.parse(Buffer.concat([decipher.update(answer.subarray(0, -16)), decipher.final()]).toString());
  check(recovered.data.status === 'active', 'encrypted Flow round trip');
  const corrupt = JSON.parse(payload); corrupt.encrypted_flow_data = Buffer.alloc(32).toString('base64');
  const corruptBody = JSON.stringify(corrupt);
  const badFlow = await fn('whatsapp-flow-endpoint', { method: 'POST', headers: sign(corruptBody), body: corruptBody });
  check((await badFlow.json()).data.error === true, 'Flow ciphertext tamper denied');
  console.log('FULLSTACK_PASS: Functions signatures encrypted Flow and disabled outbound');

  const connect = async () => {
    const ws = new WebSocket(`ws://api-gw:8000/realtime/v1/websocket?apikey=${settings.anon}&vsn=1.0.0`);
    const messages = [];
    ws.addEventListener('message', (event) => { messages.push(JSON.parse(event.data)); });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { ws.close(); reject(new Error('FULLSTACK_ASSERT:websocket open timeout')); }, 15000);
      ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('FULLSTACK_ASSERT:websocket handshake')); }, { once: true });
    });
    const wait = async (predicate) => {
      for (let i = 0; i < 150; i++) { const match = messages.find(predicate); if (match) return match; await delay(100); }
      throw new Error('FULLSTACK_ASSERT:websocket message timeout');
    };
    return { ws, wait, messages };
  };
  const topic = 'realtime:probe-allowed';
  const joinPayload = (token) => ({ config: { broadcast: { ack: true, self: true }, presence: { key: '' }, postgres_changes: [], private: true }, access_token: token });
  const allowed = await connect(); const unauthorized = await connect();
  try {
    allowed.ws.send(JSON.stringify({ topic, event: 'phx_join', payload: joinPayload(session.access_token), ref: '1', join_ref: '1' }));
    const joined = await allowed.wait((message) => message.ref === '1' && message.event === 'phx_reply');
    check(joined.payload.status === 'ok', 'Realtime authenticated private subscription');
    allowed.ws.send(JSON.stringify({ topic, event: 'broadcast', payload: { type: 'broadcast', event: 'synthetic-event', payload: { synthetic: true } }, ref: '2', join_ref: '1' }));
    const event = await allowed.wait((message) => message.event === 'broadcast' && message.payload.event === 'synthetic-event');
    check(event.payload.payload.synthetic === true, 'Realtime private event received');
    unauthorized.ws.send(JSON.stringify({ topic, event: 'phx_join', payload: joinPayload(settings.anon), ref: '3', join_ref: '3' }));
    const rejected = await unauthorized.wait((message) => message.ref === '3' && message.event === 'phx_reply');
    check(rejected.payload.status === 'error', 'Realtime anonymous private channel denied');
  } finally { allowed.ws.close(); unauthorized.ws.close(); }
  const otherLogin = await call('/auth/v1/token?grant_type=password', { method: 'POST',
    headers: { apikey: settings.anon, 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'manager-two@barber.test', password: settings.otherManagerPassword }) });
  check(otherLogin.status === 200, 'other tenant authenticated login');
  const otherSession = await otherLogin.json();
  const ownChanges = await connect(); const otherChanges = await connect();
  try {
    const changeTopic = 'realtime:bookings-realtime';
    const subscribeChanges = async (client, token) => {
      client.ws.send(JSON.stringify({ topic: changeTopic, event: 'phx_join', ref: '4', join_ref: '4',
        payload: { access_token: token, config: { broadcast: { ack: false, self: false }, presence: { key: '' },
          postgres_changes: [{ event: 'UPDATE', schema: 'public', table: 'bookings' }] } } }));
      const joined = await client.wait((message) => message.ref === '4' && message.event === 'phx_reply');
      check(joined.payload.status === 'ok', 'Realtime Postgres subscription accepted');
      const subscribed = await client.wait((message) => message.event === 'system' && message.payload.extension === 'postgres_changes');
      check(subscribed.payload.status === 'ok', 'Realtime Postgres subscription active');
    };
    await subscribeChanges(ownChanges, barber.access_token);
    await subscribeChanges(otherChanges, otherSession.access_token);
    const marker = 'synthetic-realtime-' + randomBytes(8).toString('hex');
    const updated = await call('/rest/v1/bookings?id=eq.50000000-0000-4000-8000-000000000001', {
      method: 'PATCH', headers: { ...service, 'content-type': 'application/json', prefer: 'return=representation' },
      body: JSON.stringify({ notes: marker }) });
    check(updated.status === 200 && (await updated.json()).length === 1, 'synthetic booking update');
    const changed = (message) => message.event === 'postgres_changes'
      && message.payload.data.record.id === '50000000-0000-4000-8000-000000000001'
      && message.payload.data.record.notes === marker;
    await ownChanges.wait(changed);
    // A bounded negative check after positive delivery, with both database
    // subscriptions acknowledged and the other tenant connection still live.
    await delay(5000);
    otherChanges.ws.send(JSON.stringify({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: '5' }));
    const heartbeat = await otherChanges.wait((message) => message.ref === '5' && message.event === 'phx_reply');
    check(heartbeat.payload.status === 'ok' && !otherChanges.messages.some(changed), 'Realtime authenticated cross tenant filtering');
  } finally { ownChanges.ws.close(); otherChanges.ws.close(); }
  console.log('PASS: real gateway Auth login, REST RLS, private Storage, CORS and admin denials; Functions database/JWT/cron/Meta/exact paths, encrypted Flow and outbound-disabled behavior; Realtime private broadcast/anonymous denial and actual booking Postgres UPDATE delivery with bounded authenticated cross-tenant filtering.');
}
