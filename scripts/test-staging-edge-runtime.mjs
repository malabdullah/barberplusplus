// Opt-in, synthetic-only compatibility test. No DB, Auth or integration keys.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { packageFunctions, verifyFunctionBundle } from './package-staging-functions.mjs';

const image = readFileSync('ops/staging-vps/edge-runtime.image', 'utf8').trim();
assert.match(image, /^supabase\/edge-runtime:v1\.74\.0@sha256:[a-f0-9]{64}$/);
const probeImage = 'node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e';
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 180000 }).trim();
const root = mkdtempSync(join(tmpdir(), 'barber-edge-test-'));
const bundle = join(root, 'functions');
const name = `barber-edge-test-${randomUUID()}`;
const online = `${name}-imports`; const offline = `${name}-offline`;
const createdNetworks = []; let createdContainer = false;
const jwtSecret = randomUUID() + randomUUID();
const cron = randomUUID(); const meta = randomUUID(); const verify = randomUUID();
const encode = (data) => Buffer.from(JSON.stringify(data)).toString('base64url');
const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ role: 'anon', exp: Math.floor(Date.now() / 1000) + 1200 })}`;
const token = unsigned + '.' + createHmac('sha256', jwtSecret).update(unsigned).digest('base64url');

async function probe(settings) {
  const { default: assert } = await import('node:assert/strict');
  const { createHmac } = await import('node:crypto');
  const { setTimeout: delay } = await import('node:timers/promises');
  const base = 'http://127.0.0.1:9000';
  const call = (path, init = {}) => fetch(base + path, { ...init, signal: AbortSignal.timeout(45000) });
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try { if ((await call('/unknown')).status === 404) { ready = true; break; } } catch { /* startup */ }
    await delay(250);
  }
  assert.ok(ready, 'Gateway did not start');
  const jwt = { authorization: `Bearer ${settings.token}` };
  for (const path of ['/main', '/get-kuwait-governorates/', '/whatsapp-webhook/child', '/%77hatsapp-webhook']) assert.equal((await call(path)).status, 404, path);
  assert.equal((await call('/get-kuwait-governorates')).status, 401);
  assert.equal((await call('/get-kuwait-governorates', { headers: { authorization: 'Bearer invalid' } })).status, 401);
  assert.equal((await call('/cleanup-notifications', { method: 'POST' })).status, 401);
  assert.equal((await call('/whatsapp-webhook', { method: 'POST', body: '{}' })).status, 401);
  assert.equal((await call('/whatsapp-flow-endpoint', { method: 'POST', body: '{}' })).status, 401);
  assert.equal((await call('/whatsapp-flow-endpoint')).status, 405);
  assert.equal((await call('/invite-barber', { method: 'OPTIONS', headers: { origin: 'https://staging-barber.malabdullah.cloud' } })).status, 204);
  assert.equal((await call('/invite-barber', { method: 'OPTIONS', headers: { origin: 'https://outside.invalid' } })).status, 403);

  // All eight real workers must boot. Calls stop before any database/integration
  // operation; those credentials are deliberately absent from the container.
  const gov = await call('/get-kuwait-governorates?areas=false', { headers: jwt });
  assert.equal(gov.status, 200, 'Governorates worker');
  assert.equal((await gov.json()).count, 6);
  assert.equal((await call('/auth-rate-limiter', { headers: jwt })).status, 405, 'Rate-limit worker');
  assert.equal((await call('/invite-barber', { method: 'POST', headers: jwt, body: 'x'.repeat(10241) })).status, 413, 'Invite worker');
  const send = await call('/send-whatsapp-message', { method: 'POST', headers: jwt, body: '{}' });
  assert.equal(send.status, 500);
  assert.equal((await send.json()).error, 'Missing Supabase environment variables', 'Send worker must boot and fail closed');
  for (const path of ['/cleanup-notifications', '/send-booking-reminders']) {
    const response = await call(path, { method: 'POST', headers: { 'x-cron-secret': settings.cron } });
    assert.equal(response.status, 500, path);
    const body = await response.json();
    assert.equal(body.success, false, path);
    assert.ok(typeof body.error === 'string' && body.error.includes('Missing'), path);
  }
  const challenge = await call(`/whatsapp-webhook?hub.mode=subscribe&hub.verify_token=${settings.verify}&hub.challenge=synthetic-runtime-check`);
  assert.equal(challenge.status, 200, 'Webhook worker');
  assert.equal(await challenge.text(), 'synthetic-runtime-check');
  const body = JSON.stringify({ action: 'ping' });
  const signature = 'sha256=' + createHmac('sha256', settings.meta).update(body).digest('hex');
  const flow = await call('/whatsapp-flow-endpoint', { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature }, body });
  assert.equal(flow.status, 200, 'Flow uses an error envelope with HTTP 200');
  assert.ok((await flow.text()).includes('encrypted'), 'Flow worker must boot and enforce encryption');
  console.log('PASS: all eight real workers boot; JWT, cron, Meta, exact paths, CORS and plaintext Flow rejection.');
}

try {
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const manifest = packageFunctions(resolve('.'), commit, bundle);
  verifyFunctionBundle(bundle);
  docker('pull', image); docker('pull', probeImage);
  docker('network', 'create', '--label', 'barber.purpose=edge-runtime-test', online); createdNetworks.push(online);
  docker('network', 'create', '--internal', '--label', 'barber.purpose=edge-runtime-test', offline); createdNetworks.push(offline);
  docker('create', '--name', name, '--label', 'barber.purpose=edge-runtime-test', '--network', online,
    '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
    '--memory', '768m', '--cpus', '2', '--pids-limit', '256',
    '--tmpfs', '/tmp:rw,nosuid,size=64m', '--tmpfs', '/root/.cache:rw,nosuid,size=256m',
    '--mount', `type=bind,src=${bundle},dst=/home/deno/functions,readonly`,
    '-e', 'APP_ENV=staging', '-e', 'APP_URL=https://staging-barber.malabdullah.cloud',
    '-e', `JWT_SECRET=${jwtSecret}`, '-e', `CRON_SHARED_SECRET=${cron}`,
    '-e', `WHATSAPP_APP_SECRET=${meta}`, '-e', `WHATSAPP_VERIFY_TOKEN=${verify}`,
    '-e', 'OUTBOUND_RECIPIENT_ALLOWLIST=', '-e', 'WHATSAPP_ACCESS_TOKEN=', '-e', 'ANTHROPIC_API_KEY=',
    image, 'start', '--main-service', '/home/deno/functions/main');
  createdContainer = true;
  docker('start', name);
  const input = `await (${probe.toString()})(${JSON.stringify({ token, cron, meta, verify })});`;
  const runProbe = () => execFileSync('docker', ['run', '--rm', '-i', '--name', `${name}-probe`, '--network', `container:${name}`,
    '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', probeImage, 'node', '--input-type=module'],
  { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 180000 });
  // Import downloads only; no operational credentials or real recipient data.
  console.log('Warming pinned runtime imports with synthetic-only requests.');
  console.log(runProbe().trim());
  docker('network', 'connect', offline, name);
  docker('network', 'disconnect', online, name);
  const state = JSON.parse(docker('inspect', name))[0];
  assert.deepEqual(Object.keys(state.NetworkSettings.Networks), [offline]);
  assert.ok(Object.values(state.NetworkSettings.Ports).every((p) => !p?.length));
  assert.equal(JSON.parse(docker('network', 'inspect', offline))[0].Internal, true);
  console.log('Repeating without external network access.');
  console.log(runProbe().trim());
  console.log(JSON.stringify({ sourceCommit: commit, treeSha256: manifest.treeSha256, runtimeImage: image, scope: 'local-runtime-compatibility-not-VPS-acceptance' }));
} catch (error) {
  // Only this disposable container has synthetic credentials. Still suppress
  // command arguments and any environment values from diagnostics.
  if (createdContainer) {
    const state = JSON.parse(docker('inspect', name))[0];
    console.error(JSON.stringify({ running: state.State.Running, exitCode: state.State.ExitCode, oomKilled: state.State.OOMKilled }));
    const logs = spawnSync('docker', ['logs', '--tail', '35', name], { encoding: 'utf8', timeout: 10000 });
    console.error((logs.stdout + logs.stderr).replaceAll(jwtSecret, '[test-key]').replaceAll(cron, '[test-key]').replaceAll(meta, '[test-key]').replaceAll(verify, '[test-key]'));
  }
  console.error(error.stderr?.toString().replaceAll(token, '[test-token]').replaceAll(verify, '[test-key]') || 'Edge Runtime compatibility test failed');
  process.exitCode = 1;
} finally {
  try { docker('rm', '-f', `${name}-probe`); } catch { /* probe auto-removes */ }
  if (createdContainer) docker('rm', '-f', name);
  for (const network of createdNetworks.reverse()) docker('network', 'rm', network);
  rmSync(root, { recursive: true });
}
