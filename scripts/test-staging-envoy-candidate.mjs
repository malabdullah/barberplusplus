// Candidate-only routing probe: synthetic backend, internal network, no host ports.
// This does not validate real Auth/Storage/Functions or change the deployment pin.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { localDockerProbe } from './local-docker-probe.mjs';

const image = 'envoyproxy/envoy@sha256:43b69cf424922cd5d1086cc019dc89197e58d58deac89d36b3c8b67f1a9e8523';
const probeImage = 'node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e';
assert.equal(process.argv.length, 3, 'Pass the verified self-hosted/v0.8.0 upstream directory');
const configRoot = join(realpathSync(resolve(process.argv[2])), 'volumes/api/envoy');
assert.ok(!/[\r\n,]/.test(configRoot), 'Unsafe Docker mount path');
const expectedFiles = {
  'cds.yaml': '1d7514b891370ed27c25911df008887402e16ab09273e6e433225bb7f09f7905',
  'docker-entrypoint.sh': '7ae0abaa8d76332d001e60dc29d4f29985890f89e04ee78489abbf680495631d',
  'envoy.yaml': '3697f23b0be9ec5b829f937c600eb9b878f1f778ab510b42ad5e4f14742447e9',
  'lds.template.yaml': '55f5b61fff7409a29f7fe2a0d4a35ba77cf83f849eb411ab89602b3f364f81bd',
};
for (const [file, digest] of Object.entries(expectedFiles)) {
  assert.equal(createHash('sha256').update(readFileSync(join(configRoot, file))).digest('hex'), digest,
    'Gateway config differs from reviewed upstream source');
}
const localDocker = localDockerProbe();
const docker = (...args) => localDocker(args);
const name = `barber-envoy-candidate-${randomUUID()}`;
const gateway = `${name}-gateway`; const backend = `${name}-backend`; const client = `${name}-client`;
let networkCreated = false; const containers = [];
const env = {
  ANON_KEY: randomUUID(), SERVICE_ROLE_KEY: randomUUID(),
  SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${randomUUID()}`, SUPABASE_SECRET_KEY: `sb_secret_${randomUUID()}`,
  ANON_KEY_ASYMMETRIC: randomUUID(), SERVICE_ROLE_KEY_ASYMMETRIC: randomUUID(),
  DASHBOARD_USERNAME: 'synthetic-admin', DASHBOARD_PASSWORD: randomUUID(),
};

async function probe(settings) {
  const { default: assert } = await import('node:assert/strict');
  const { request } = await import('node:http');
  const { setTimeout: delay } = await import('node:timers/promises');
  const call = (path, headers = {}, method = 'GET', body = '') => new Promise((resolve, reject) => {
    const req = request({ hostname: 'gateway', port: 8000, path, method,
      headers: { ...headers, 'content-length': Buffer.byteLength(body) }, timeout: 5000 }, (res) => {
      let text = '';
      res.on('data', (chunk) => { text += chunk; if (text.length > 16384) res.destroy(new Error('Response too large')); });
      res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode, text }));
    });
    req.on('error', reject); req.on('timeout', () => req.destroy(new Error('Request timed out')));
    req.end(body);
  });
  const anon = { apikey: settings.ANON_KEY };
  const admin = { apikey: settings.SERVICE_ROLE_KEY };
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { if ((await call('/auth/v1/health', anon)).status === 200) { ready = true; break; } } catch { /* startup */ }
    await delay(250);
  }
  assert.ok(ready, 'Gateway did not become ready');
  for (const path of ['/auth/v1/user', '/rest/v1/example', '/graphql/v1', '/realtime/v1/websocket', '/pg/tables']) {
    assert.equal((await call(path)).status, 401, 'Missing API key must fail');
    assert.equal((await call(path, { apikey: 'invalid' })).status, 401, 'Invalid API key must fail');
  }
  assert.equal((await call('/pg/tables', anon)).status, 403);
  assert.equal((await call('/pg/tables', admin)).status, 200);
  assert.equal((await call('/rest/v1/', anon)).status, 403);
  assert.equal((await call('/rest/v1/', admin)).status, 200);
  for (const path of ['/mcp', '/api/mcp', '/realtime/v1/api/tenants', '/realtime/v1/api/openapi']) {
    assert.equal((await call(path, admin)).status, 403, 'Administrative endpoint must stay blocked');
  }
  const legacy = JSON.parse((await call('/rest/v1/example', anon)).text);
  assert.equal(legacy.path, '/example');
  assert.equal(legacy.headers.authorization, `Bearer ${settings.ANON_KEY}`);
  const modern = JSON.parse((await call('/rest/v1/example', { apikey: settings.SUPABASE_PUBLISHABLE_KEY })).text);
  assert.equal(modern.headers.apikey, settings.ANON_KEY_ASYMMETRIC);
  assert.equal(modern.headers.authorization, `Bearer ${settings.ANON_KEY_ASYMMETRIC}`);
  const realJwt = 'Bearer synthetic-user-token';
  const preserved = JSON.parse((await call('/rest/v1/example', { ...anon, authorization: realJwt })).text);
  assert.equal(preserved.headers.authorization, realJwt);
  const query = JSON.parse((await call(`/rest/v1/example?apikey=${settings.SUPABASE_PUBLISHABLE_KEY}`)).text);
  assert.equal(query.path, `/example?apikey=${settings.ANON_KEY_ASYMMETRIC}`);
  const ws = JSON.parse((await call('/realtime/v1/websocket', anon)).text);
  assert.equal(ws.path, '/socket/websocket'); assert.equal(ws.headers['x-api-key'], settings.ANON_KEY);
  // This backend does NOT perform HMAC/JWT checks. Verify byte/header forwarding only.
  const body = '{"synthetic":true}';
  const forwarded = JSON.parse((await call('/functions/v1/whatsapp-webhook', {
    apikey: settings.SUPABASE_PUBLISHABLE_KEY, authorization: realJwt,
    'x-hub-signature-256': 'sha256=synthetic-test-only',
  }, 'POST', body)).text);
  assert.equal(forwarded.path, '/whatsapp-webhook'); assert.equal(forwarded.body, body);
  assert.equal(forwarded.headers.apikey, settings.SUPABASE_PUBLISHABLE_KEY);
  assert.equal(forwarded.headers.authorization, realJwt);
  assert.equal(forwarded.headers['x-hub-signature-256'], 'sha256=synthetic-test-only');
  for (const path of ['/rest%2fv1/example', '/rest%5cv1/example']) {
    assert.equal((await call(path, anon)).status, 400, 'Encoded separators must fail');
  }
  for (const path of ['/rest/v1/../v1/example', '/rest/v1/..;/v1/example', '/rest/v1/;x/example', '//rest/v1/example']) {
    assert.equal((await call(path)).status, 401, 'Normalization must not bypass API key checks');
  }
  assert.equal((await call('/rest/v1/example', { ...anon, bad_header: 'reject' })).status, 400);
  assert.equal((await call('/')).status, 401, 'Dashboard must require basic auth');
  console.log('PASS: exact upstream config, protected API routes, admin denials, legacy/modern key translation, JWT preservation, websocket routing, untouched function payloads/signatures, normalization and header rejection.');
}

try {
  docker('pull', '--platform', 'linux/amd64', image); docker('pull', probeImage);
  const info = JSON.parse(docker('image', 'inspect', image))[0];
  assert.equal(info.Architecture, 'amd64'); assert.equal(info.Os, 'linux');
  docker('network', 'create', '--internal', '--label', 'barber.purpose=envoy-candidate', name); networkCreated = true;
  const hardening = ['--user', '10001:10001', '--read-only', '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges:true', '--memory', '512m', '--cpus', '1', '--pids-limit', '128',
    '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m,uid=10001,gid=10001,mode=0700'];
  const aliases = ['auth', 'rest', 'realtime-dev.supabase-realtime', 'storage', 'functions', 'meta', 'studio'];
  const server = `const http=require('node:http');for(const port of [9999,3000,4000,5000,9000,8080])http.createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({port,path:req.url,headers:req.headers,body}));});}).listen(port,'0.0.0.0');`;
  docker('create', '--name', backend, '--label', 'barber.purpose=envoy-candidate', '--network', name,
    ...aliases.flatMap((alias) => ['--network-alias', alias]), ...hardening, probeImage, 'node', '-e', server);
  containers.push(backend); docker('start', backend);
  const args = ['create', '--platform', 'linux/amd64', '--name', gateway,
    '--label', 'barber.purpose=envoy-candidate', '--network', name, '--network-alias', 'gateway', ...hardening,
    '--tmpfs', '/etc/envoy:rw,noexec,nosuid,size=16m,uid=10001,gid=10001,mode=0700'];
  for (const file of Object.keys(expectedFiles)) {
    const target = file === 'docker-entrypoint.sh' ? '/docker-entrypoint.sh' : `/etc/envoy/${file}`;
    args.push('--mount', `type=bind,src=${join(configRoot, file)},dst=${target},readonly`);
  }
  for (const [key, value] of Object.entries(env)) args.push('-e', `${key}=${value}`);
  docker(...args, '--entrypoint', '/bin/sh', image, '/docker-entrypoint.sh', '--concurrency', '1');
  containers.push(gateway); docker('start', gateway);
  assert.equal(JSON.parse(docker('network', 'inspect', name))[0].Internal, true);
  for (const container of containers) {
    const state = JSON.parse(docker('inspect', container))[0];
    assert.equal(state.Config.User, '10001:10001'); assert.equal(state.HostConfig.ReadonlyRootfs, true);
    assert.deepEqual(Object.keys(state.NetworkSettings.Networks), [name]);
    assert.ok(Object.values(state.NetworkSettings.Ports).every((ports) => !ports?.length));
  }
  const version = docker('exec', gateway, 'envoy', '--version');
  assert.ok(version.includes('50d48c6c6c964b06f1365cb54ed05a7e03ac631f/1.39.2/Clean/RELEASE/BoringSSL'),
    'Unexpected Envoy binary identity');
  const packages = docker('exec', gateway, 'dpkg-query', '-W', 'libssl3', 'openssl');
  assert.ok(packages.includes('libssl3:amd64\t3.0.2-0ubuntu1.30'));
  assert.ok(packages.includes('openssl\t3.0.2-0ubuntu1.30'));
  const routes = docker('exec', gateway, 'cat', '/proc/net/route').split('\n').slice(1);
  assert.ok(routes.every((line) => line.trim().split(/\s+/)[1] !== '00000000'), 'Unexpected default route');
  const routes6 = docker('exec', gateway, 'cat', '/proc/net/ipv6_route').split('\n').filter(Boolean);
  assert.ok(routes6.every((line) => {
    const fields = line.trim().split(/\s+/);
    return fields[0] !== '0'.repeat(32) || fields[1] !== '00' || fields.at(-1) === 'lo';
  }), 'Unexpected IPv6 default route');
  const output = localDocker(['run', '--rm', '-i', '--name', client,
    '--label', 'barber.purpose=envoy-candidate', '--network', name, ...hardening,
    probeImage, 'node', '--input-type=module'], { input: `await (${probe.toString()})(${JSON.stringify(env)});`,
    timeout: 90000 });
  console.log(output.trim());
  console.log('Candidate only: real-service integration, signed artifacts, load and VPS acceptance remain open.');
} catch {
  // Docker errors may embed command arguments; never echo synthetic credential fixtures.
  console.error('Envoy candidate probe failed; no deployment pin changed.');
  process.exitCode = 1;
} finally {
  try { docker('rm', '-f', client); } catch { /* auto-removed or not created */ }
  for (const container of containers.reverse()) docker('rm', '-f', container);
  if (networkCreated) docker('network', 'rm', name);
}
