// Opt-in, synthetic-only compatibility test. No DB, Auth or integration keys.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHmac, generateKeyPairSync, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { packageFunctions, verifyFunctionBundle } from './package-staging-functions.mjs';
import { localDockerProbe } from './local-docker-probe.mjs';
import { inspectPlatformImage } from './staging-postgres-candidate.mjs';

const pinnedImage = readFileSync('ops/staging-vps/edge-runtime.image', 'utf8').trim();
assert.match(pinnedImage, /^supabase\/edge-runtime:v1\.74\.0@sha256:[a-f0-9]{64}$/);
const probeImage = 'node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e';
const platform = process.argv[2] || (process.arch === 'arm64' ? 'linux/arm64' : 'linux/amd64');
assert.ok(process.argv.length <= 4 && ['linux/amd64', 'linux/arm64'].includes(platform), 'Unsupported probe platform');
const securityCandidate = process.argv[3] === '--security-runtime-candidate';
const releaseRuntime = process.argv[3] === '--release-runtime';
assert.ok(process.argv[3] === undefined || securityCandidate || releaseRuntime, 'Unknown runtime candidate option');
assert.ok(!(securityCandidate || releaseRuntime) || platform === 'linux/amd64', 'Security runtime is AMD64 only');
const image = securityCandidate || releaseRuntime
  ? 'supabase/edge-runtime@sha256:fded42ff725708990b1a0803633c2659453259d075c4bec6b4d01dfb82dc055e' : pinnedImage;
const candidateRef = 'sha256:b00379f2cd56e0da0e721968a0593ff8b15b0cfb758223e5316aac8d30600431';
const candidateChild = 'sha256:edfc3b271d665ed9df4e01cc1e6c0144fed184246cc30785974aa1c701c52156';
const candidateTag = 'barber-edge-runtime-security-candidate:20261004-b00379f2';
const localDocker = localDockerProbe();
const docker = (...args) => localDocker(args);
const root = mkdtempSync(join(tmpdir(), 'barber-edge-test-'));
const bundle = join(root, 'functions');
const name = `barber-edge-test-${randomUUID()}`;
const offline = `${name}-offline`;
const createdNetworks = []; let createdContainer = false;
const jwtSecret = randomUUID() + randomUUID();
const cron = randomUUID(); const meta = randomUUID(); const verify = randomUUID();
const flowKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const flowPrivate = flowKeys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const flowPublic = flowKeys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const encode = (data) => Buffer.from(JSON.stringify(data)).toString('base64url');
const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ role: 'anon', exp: Math.floor(Date.now() / 1000) + 1200 })}`;
const token = unsigned + '.' + createHmac('sha256', jwtSecret).update(unsigned).digest('base64url');
const redact = (value) => [flowPrivate, JSON.stringify(flowPrivate).slice(1, -1), jwtSecret, cron, meta, verify, token]
  .reduce((text, secret) => text.replaceAll(secret, '[synthetic-redacted]'), String(value));

async function probe(settings) {
  const { default: assert } = await import('node:assert/strict');
  const { createHmac, randomBytes, publicEncrypt, createCipheriv, createDecipheriv } = await import('node:crypto');
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
  const sign = (body) => ({ 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=' + createHmac('sha256', settings.meta).update(body).digest('hex') });
  const emptyWebhook = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });
  assert.equal((await call('/whatsapp-webhook', { method: 'POST', headers: sign(emptyWebhook), body: emptyWebhook })).status, 200);
  const body = JSON.stringify({ action: 'ping' });
  const signature = 'sha256=' + createHmac('sha256', settings.meta).update(body).digest('hex');
  const flow = await call('/whatsapp-flow-endpoint', { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature }, body });
  assert.equal(flow.status, 200, 'Flow uses an error envelope with HTTP 200');
  assert.ok((await flow.text()).includes('encrypted'), 'Flow worker must boot and enforce encryption');
  const aes = randomBytes(16); const iv = randomBytes(12);
  const cipher = createCipheriv('aes-128-gcm', aes, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify({ version: '3.0', action: 'ping' })), cipher.final(), cipher.getAuthTag()]);
  const payload = JSON.stringify({ encrypted_flow_data: encrypted.toString('base64'),
    encrypted_aes_key: publicEncrypt({ key: settings.flowPublic, oaepHash: 'sha256' }, aes).toString('base64'), initial_vector: iv.toString('base64') });
  const ping = await call('/whatsapp-flow-endpoint', { method: 'POST', headers: sign(payload), body: payload });
  assert.equal(ping.status, 200);
  const answer = Buffer.from(await ping.text(), 'base64');
  const decipher = createDecipheriv('aes-128-gcm', aes, iv.map((byte) => byte ^ 255));
  decipher.setAuthTag(answer.subarray(-16));
  const recovered = JSON.parse(Buffer.concat([decipher.update(answer.subarray(0, -16)), decipher.final()]).toString());
  assert.equal(recovered.data.status, 'active', 'Encrypted Flow ping must round-trip');
  const corrupted = JSON.parse(payload); corrupted.encrypted_flow_data = Buffer.alloc(32).toString('base64');
  const badBody = JSON.stringify(corrupted);
  const bad = await call('/whatsapp-flow-endpoint', { method: 'POST', headers: sign(badBody), body: badBody });
  assert.equal((await bad.json()).data.error, true, 'Bad ciphertext must be rejected despite valid HMAC');
  console.log('PASS: all eight workers; JWT, cron, Meta, exact paths, CORS, encrypted Flow round-trip and tamper rejection.');
}

try {
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const manifest = packageFunctions(resolve('.'), commit, bundle);
  verifyFunctionBundle(bundle);
  docker('pull', '--platform', platform, image); docker('pull', '--platform', platform, probeImage);
  if (securityCandidate) {
    const candidate = inspectPlatformImage(localDocker, candidateRef, platform);
    assert.equal(candidate.Id, candidateChild, 'Unreviewed minimal runtime image');
    assert.equal(candidate.Config.User, '10001:10001');
    assert.equal(candidate.Config.Labels['cloud.malabdullah.barber.candidate'], 'edge-runtime-security-local-only');
    assert.equal(candidate.Config.Labels['cloud.malabdullah.barber.upstream-manifest'], image.split('@')[1]);
    assert.deepEqual(candidate.Config.Entrypoint, ['edge-runtime']);
    // Local-only alias enables BuildKit FROM resolution; verify its immutable
    // child before and after the build. This is never a deployment reference.
    const existing = docker('image', 'ls', '--quiet', '--no-trunc', '--filter', `reference=${candidateTag}`);
    if (existing) assert.equal(inspectPlatformImage(localDocker, candidateTag, platform).Id, candidateChild,
      'Refusing to overwrite an unrelated local tag');
    docker('tag', candidateRef, candidateTag);
  }
  const compiledImage = `barber-staging-functions-check:${commit}-${name.slice(-8)}`;
  console.log('Compiling immutable function artifacts; no credentials enter the build.');
  const buildArgs = releaseRuntime ? [] : ['--build-arg', `EDGE_RUNTIME_IMAGE=${image}`,
    '--build-arg', `EDGE_RUNTIME_FINAL_IMAGE=${securityCandidate ? candidateTag : image}`];
  localDocker(['build', '--platform', platform, ...buildArgs,
    '-f', releaseRuntime ? 'ops/staging-vps/Dockerfile.functions-release' : 'ops/staging-vps/Dockerfile.functions',
    '-t', compiledImage, bundle], { timeout: 900000 });
  if (securityCandidate) assert.equal(inspectPlatformImage(localDocker, candidateTag, platform).Id, candidateChild);
  const compiledMetadata = inspectPlatformImage(localDocker, compiledImage, platform);
  if (releaseRuntime) {
    assert.equal(compiledMetadata.Config.User, '10001:10001');
    assert.equal(compiledMetadata.Config.Labels['cloud.malabdullah.barber.runtime'], 'edge-runtime-security-release');
    assert.equal(compiledMetadata.Config.Labels['cloud.malabdullah.barber.upstream-manifest'], image.split('@')[1]);
    assert.deepEqual(compiledMetadata.Config.Entrypoint, ['edge-runtime']);
  }
  docker('network', 'create', '--internal', '--label', 'barber.purpose=edge-runtime-test', offline); createdNetworks.push(offline);
  docker('create', '--platform', platform, '--name', name, '--label', 'barber.purpose=edge-runtime-test', '--network', offline,
    '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
    '--memory', '768m', '--cpus', '1', '--pids-limit', '256',
    '--tmpfs', '/tmp:rw,noexec,nosuid,size=128m,uid=10001,gid=10001,mode=0700',
    '-e', 'APP_ENV=staging', '-e', 'APP_URL=https://staging-barber.malabdullah.cloud',
    '-e', `JWT_SECRET=${jwtSecret}`, '-e', `CRON_SHARED_SECRET=${cron}`,
    '-e', `WHATSAPP_APP_SECRET=${meta}`, '-e', `WHATSAPP_VERIFY_TOKEN=${verify}`,
    '-e', `WHATSAPP_FLOW_PRIVATE_KEY=${flowPrivate}`,
    '-e', 'OUTBOUND_RECIPIENT_ALLOWLIST=', '-e', 'WHATSAPP_ACCESS_TOKEN=', '-e', 'OPENAI_API_KEY=', '-e', 'AI_OUTBOUND_ENABLED=false',
    compiledImage);
  createdContainer = true;
  docker('start', name);
  const input = `await (${probe.toString()})(${JSON.stringify({ token, cron, meta, verify, flowPublic })});`;
  const runProbe = () => localDocker(['run', '--platform', platform, '--rm', '-i', '--name', `${name}-probe`, '--network', `container:${name}`,
    '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', probeImage, 'node', '--input-type=module'],
  { input, timeout: 180000 });
  const state = JSON.parse(docker('inspect', name))[0];
  assert.deepEqual(Object.keys(state.NetworkSettings.Networks), [offline]);
  assert.ok(Object.values(state.NetworkSettings.Ports).every((p) => !p?.length));
  assert.equal(JSON.parse(docker('network', 'inspect', offline))[0].Internal, true);
  assert.equal(state.Config.User, '10001:10001');
  assert.equal(state.HostConfig.ReadonlyRootfs, true);
  assert.ok(state.Mounts.every((mount) => mount.Type === 'tmpfs' && mount.Destination === '/tmp'), 'No host mounts or persistent volumes may enter the test');
  console.log('Cold-starting compiled functions without external network access.');
  console.log(runProbe().trim());
  console.log(JSON.stringify({ sourceCommit: commit, treeSha256: manifest.treeSha256, runtimeImage: image, compiledImage,
    minimalRuntimeImage: securityCandidate ? candidateRef : null, minimalRuntimePlatformId: securityCandidate ? candidateChild : null,
    releaseRuntime, platform, platformImageId: compiledMetadata.Id,
    imageId: docker('image', 'inspect', compiledImage, '--format', '{{.Id}}'), scope: 'local-runtime-compatibility-not-VPS-acceptance' }));
} catch (error) {
  // Only this disposable container has synthetic credentials. Still suppress
  // command arguments and any environment values from diagnostics.
  if (createdContainer) {
    const state = JSON.parse(docker('inspect', name))[0];
    console.error(JSON.stringify({ running: state.State.Running, exitCode: state.State.ExitCode, oomKilled: state.State.OOMKilled }));
    let logs = '';
    try { logs = localDocker(['logs', '--tail', '35', name], { timeout: 10000 }); } catch { /* No raw exception/arguments. */ }
    console.error(redact(logs));
  }
  console.error(error.stderr ? redact(error.stderr) : 'Edge Runtime compatibility test failed');
  process.exitCode = 1;
} finally {
  try { docker('rm', '-f', `${name}-probe`); } catch { /* probe auto-removes */ }
  if (createdContainer) docker('rm', '-f', name);
  for (const network of createdNetworks.reverse()) docker('network', 'rm', network);
  rmSync(root, { recursive: true });
}
