// Synthetic-only acceptance. Secrets are read through SSH into memory, never logged.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { parseEnv } from 'node:util';
import { createHmac, randomBytes, publicEncrypt, createCipheriv, createDecipheriv } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';
import { manualFirstRelease as release } from './staging-manual-first-release.mjs';
import { isPrivateStorageDenied } from './rehearse-staging-core-recovery.mjs';

let stage = 'read protected staging configuration'; let originalNotes; let restore; const sockets = [];
const results = [];
try {
  const accessEnv = parseEnv(readFileSync('/Users/malabdullah/Documents/Barber++ Staging Secrets/cloudflare-access-service-token.env', 'utf8'));
  const access = { 'CF-Access-Client-Id': accessEnv.ACCESS_CLIENT_ID, 'CF-Access-Client-Secret': accessEnv.ACCESS_CLIENT_SECRET };
  assert.ok(accessEnv.ACCESS_CLIENT_ID && accessEnv.ACCESS_CLIENT_SECRET);
  const remote = `const fs=require("node:fs"),crypto=require("node:crypto");const root="/opt/barber-staging/";
    const model=JSON.parse(fs.readFileSync(root+"manual-first-release/backend.private-origin.json"));
    const env=model.services.functions.environment;
    if(env.APP_ENV!=="staging"||env.AI_OUTBOUND_ENABLED!=="false"||env.OPENAI_API_KEY||env.WHATSAPP_ACCESS_TOKEN||env.OUTBOUND_RECIPIENT_ALLOWLIST)process.exit(2);
    process.stdout.write(JSON.stringify({anon:env.SUPABASE_ANON_KEY,key:env.SUPABASE_SERVICE_ROLE_KEY,meta:env.WHATSAPP_APP_SECRET,
    flowPublic:crypto.createPublicKey(env.WHATSAPP_FLOW_PRIVATE_KEY).export({type:"spki",format:"pem"}),
    accounts:JSON.parse(fs.readFileSync(root+"supabase/synthetic-accounts.json"))}));`;
  const settings = JSON.parse(execFileSync('ssh', ['-i', '/Users/malabdullah/.ssh/barber_staging_admin_ed25519',
    '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', 'barber-admin@185.97.146.8',
    'sudo -n /opt/barber-staging-observer/node -'], { input: remote, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 15000 }));
  const call = (path, options = {}, authenticated = true) => {
    assert.ok(path.startsWith('/') && !path.startsWith('//'));
    const origin = authenticated && /^\/(auth|rest|storage|realtime|functions)\/v1(\/|$)/.test(path) ? release.appUrl : release.apiUrl;
    return fetch(origin + path, { ...options, headers: { ...(authenticated ? access : {}), ...options.headers },
      redirect: 'manual', signal: AbortSignal.timeout(15000) });
  };
  const pass = name => { results.push(name); console.log(JSON.stringify({ check: name, passed: true })); };
  const login = async email => {
    const account = settings.accounts.find(a => a.email === email); assert.ok(account);
    const r = await call('/auth/v1/token?grant_type=password', { method: 'POST', headers: { apikey: settings.anon, 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: account.password }) });
    assert.equal(r.status, 200); return r.json();
  };
  const admin = await login('admin@barber.test'); const barber = await login('barber@barber.test');
  const other = await login('manager-two@barber.test');
  const jwt = { apikey: settings.anon, authorization: `Bearer ${admin.access_token}` };
  const service = { apikey: settings.key, authorization: `Bearer ${settings.key}` };
  stage = 'Storage bytes and anonymous denial';
  for (const [file, expected] of [['check.txt', 'synthetic-only'], ['gateway.txt', 'synthetic-gateway-only']]) {
    const r = await call(`/storage/v1/object/authenticated/synthetic-probe/${file}`, { headers: service });
    assert.equal(r.status, 200); assert.equal(await r.text(), expected);
  }
  const denied = await call('/storage/v1/object/authenticated/synthetic-probe/check.txt', {
    headers: { apikey: settings.anon, authorization: `Bearer ${settings.anon}` } });
  assert.ok(isPrivateStorageDenied(denied.status, await denied.json())); pass(stage);
  stage = 'hostile origins and management denied';
  for (const path of ['/auth/v1/user', '/rest/v1/branches', '/functions/v1/get-kuwait-governorates']) {
    const r = await call(path, { headers: { ...jwt, origin: 'https://hostile.invalid' } });
    assert.equal(r.status, 403); assert.equal(r.headers.has('access-control-allow-origin'), false); await r.arrayBuffer();
  }
  for (const path of ['/pg/tables', '/mcp', '/api/mcp', '/realtime/v1/api/tenants']) {
    const r = await call(path, { headers: service }); assert.equal(r.status, 403); await r.arrayBuffer();
  }
  pass(stage);
  stage = 'signed webhook and encrypted Flow';
  const sign = body => ({ 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=' + createHmac('sha256', settings.meta).update(body).digest('hex') });
  const empty = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });
  const accepted = await call('/functions/v1/whatsapp-webhook', { method: 'POST', headers: sign(empty), body: empty }, false);
  assert.equal(accepted.status, 200); await accepted.arrayBuffer();
  const tampered = await call('/functions/v1/whatsapp-webhook', { method: 'POST', headers: sign(empty), body: empty + ' ' }, false);
  assert.equal(tampered.status, 401); await tampered.arrayBuffer();
  const plain = JSON.stringify({ action: 'ping' });
  const plainResponse = await call('/functions/v1/whatsapp-flow-endpoint', { method: 'POST', headers: sign(plain), body: plain }, false);
  assert.equal(plainResponse.status, 200); assert.ok((await plainResponse.text()).includes('encrypted'));
  const aes = randomBytes(16); const iv = randomBytes(12); const cipher = createCipheriv('aes-128-gcm', aes, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify({ version: '3.0', action: 'ping' })), cipher.final(), cipher.getAuthTag()]);
  const payload = JSON.stringify({ encrypted_flow_data: encrypted.toString('base64'), encrypted_aes_key: publicEncrypt({ key: settings.flowPublic, oaepHash: 'sha256' }, aes).toString('base64'), initial_vector: iv.toString('base64') });
  const ping = await call('/functions/v1/whatsapp-flow-endpoint', { method: 'POST', headers: sign(payload), body: payload }, false);
  assert.equal(ping.status, 200); const answer = Buffer.from(await ping.text(), 'base64');
  const decipher = createDecipheriv('aes-128-gcm', aes, iv.map(byte => byte ^ 255)); decipher.setAuthTag(answer.subarray(-16));
  const recovered = JSON.parse(Buffer.concat([decipher.update(answer.subarray(0, -16)), decipher.final()]).toString());
  assert.equal(recovered.data.status, 'active'); pass(stage);
  stage = 'external outbound disabled';
  const send = await call('/functions/v1/send-whatsapp-message', { method: 'POST', headers: jwt, body: '{}' });
  assert.equal(send.status, 500); assert.equal((await send.json()).error, 'Missing WhatsApp API configuration'); pass(stage);
  stage = 'Realtime subscription and tenant filtering';
  const connect = async token => {
    const ws = new WebSocket(`${release.appUrl.replace('https:', 'wss:')}/realtime/v1/websocket?apikey=${settings.anon}&vsn=1.0.0`, { headers: access });
    sockets.push(ws); const messages = []; ws.on('message', data => messages.push(JSON.parse(data.toString())));
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { ws.terminate(); reject(new Error('handshake timeout')); }, 15000);
      ws.once('open', () => { clearTimeout(timer); resolve(); }); ws.once('error', () => { clearTimeout(timer); reject(new Error('handshake failed')); });
    });
    const wait = async predicate => { for (let i = 0; i < 150; i++) { const m = messages.find(predicate); if (m) return m; await delay(100); } throw new Error('message timeout'); };
    ws.send(JSON.stringify({ topic: 'realtime:env3-live-acceptance', event: 'phx_join', ref: '1', join_ref: '1', payload: {
      access_token: token, config: { broadcast: { ack: false, self: false }, presence: { key: '' }, postgres_changes: [{ event: 'UPDATE', schema: 'public', table: 'bookings' }] } } }));
    assert.equal((await wait(m => m.ref === '1' && m.event === 'phx_reply')).payload.status, 'ok');
    assert.equal((await wait(m => m.event === 'system' && m.payload.extension === 'postgres_changes')).payload.status, 'ok');
    return { ws, messages, wait };
  };
  const ownSocket = await connect(barber.access_token); const otherSocket = await connect(other.access_token);
  const booking = '/rest/v1/bookings?id=eq.50000000-0000-4000-8000-000000000001';
  const before = await call(booking + '&select=notes', { headers: service }); assert.equal(before.status, 200);
  const rows = await before.json(); assert.equal(rows.length, 1); originalNotes = rows[0].notes;
  restore = async () => {
    const r = await call(booking, { method: 'PATCH', headers: { ...service, 'content-type': 'application/json', prefer: 'return=representation' }, body: JSON.stringify({ notes: originalNotes }) });
    assert.equal(r.status, 200); assert.equal((await r.json())[0].notes, originalNotes);
  };
  const marker = 'synthetic-live-acceptance-' + randomBytes(8).toString('hex');
  const updated = await call(booking, { method: 'PATCH', headers: { ...service, 'content-type': 'application/json', prefer: 'return=representation' }, body: JSON.stringify({ notes: marker }) });
  assert.equal(updated.status, 200); assert.equal((await updated.json()).length, 1);
  const changed = m => m.event === 'postgres_changes' && m.payload.data.record.notes === marker;
  await ownSocket.wait(changed); await delay(5000);
  otherSocket.ws.send(JSON.stringify({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: '2' }));
  assert.equal((await otherSocket.wait(m => m.ref === '2' && m.event === 'phx_reply')).payload.status, 'ok');
  assert.equal(otherSocket.messages.some(changed), false); await restore(); restore = null; pass(stage);
  stage = 'bounded public read load';
  const latencies = []; let errors = 0;
  await Promise.all(Array.from({ length: 3 }, async () => {
    for (let i = 0; i < 10; i++) {
      const start = performance.now();
      const r = await call('/rest/v1/branches?select=id&limit=5', { headers: jwt });
      await r.arrayBuffer(); if (r.status !== 200) errors++; latencies.push(performance.now() - start); await delay(250);
    }
  }));
  latencies.sort((a, b) => a - b); assert.equal(errors, 0); assert.ok(latencies[28] < 2000);
  pass(stage);
  const result = { status: 'public-integration-checks-passed', commit: release.commit, checks: results,
    syntheticNotesRestored: true, publicReadRequests: 30, concurrency: 3, p95Ms: Math.round(latencies[28]), errors,
    realProviderCallsEnabled: false, fullCapacityAccepted: false, testedAt: new Date().toISOString() };
  console.log(JSON.stringify(result));
  if (process.env.STAGING_ACCEPTANCE_REPORT) writeFileSync(process.env.STAGING_ACCEPTANCE_REPORT, JSON.stringify(result, null, 2), { flag: 'wx', mode: 0o600 });
} catch (error) {
  console.error(JSON.stringify({ status: 'failed', stage, completed: results }));
  const line = String(error?.stack || '').match(/accept-manual-staging-integrations\.mjs:(\d+):(\d+)/);
  if (line) console.error(`Check location: ${line[1]}:${line[2]}`);
  process.exitCode = 1;
} finally {
  if (restore) { try { await restore(); console.log('Synthetic booking notes restored.'); } catch { console.error('Synthetic booking note restoration requires operator attention.'); process.exitCode = 1; } }
  for (const ws of sockets) ws.close();
}
