// Owner-approved exact release, recovery from the retained loopback attempt.
// Keeps Docker internal networks and publishes no ports; host tunnel uses private IPs.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, lstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { hostname } from 'node:os';
import { localDockerProbe } from './local-docker-probe.mjs';
import { prepareManualFirstRelease, manualFirstRelease as release } from './staging-manual-first-release.mjs';
import { INSTALL_ROOT, PROJECT, OWNER_LABEL, APPROVED_SOURCE } from './staging-private-model.mjs';

const sha = data => createHash('sha256').update(data).digest('hex');
const read = name => JSON.parse(readFileSync(name));
let stage = 'preflight'; let mutated = false; let docker; let compose; let original; let frontend;
try {
  assert.equal(hostname(), 'srv1207055'); assert.equal(process.getuid(), 0);
  assert.ok(process.argv.length === 3 && ['--preflight-only', '--owner-approved-6217cb3'].includes(process.argv[2]));
  assert.ok(Date.now() < Date.parse('2026-10-18T00:00:00Z'));
  const dir = lstatSync(release.root);
  assert.ok(dir.isDirectory() && !dir.isSymbolicLink() && dir.uid === 0 && (dir.mode & 0o777) === 0o700);
  for (const file of ['origin-verified.json', 'private-origin-started.json']) assert.equal(existsSync(`${release.root}/${file}`), false);
  const started = read(`${release.root}/started.json`);
  assert.deepEqual(started.release, release);
  assert.equal(started.automationEnabled, false);
  const source = readFileSync(`${INSTALL_ROOT}/compose.private.json`);
  assert.equal(sha(source), '15016fbbc08ce25c311783227f4b039288e4b6ed1cd584d6188605a32ef5da5d');
  assert.equal(sha(source), started.originalComposeSha256);
  original = JSON.parse(source);
  const prepared = read(`${INSTALL_ROOT}/prepared.json`);
  assert.equal(sha(source), prepared.composeSha256);
  assert.deepEqual(started.migrations, prepared.migrations);
  for (const [file, hash] of Object.entries(prepared.migrations)) assert.equal(sha(readFileSync(`${INSTALL_ROOT}/migrations/${file}`)), hash);
  const candidate = prepareManualFirstRelease(original, {
    runtime: readFileSync(new URL('../docker/runtime-config.js.template', import.meta.url), 'utf8'),
    nginx: readFileSync(new URL('../docker/nginx.conf.template', import.meta.url), 'utf8'),
  });
  for (const [file, hash] of Object.entries(started.files)) assert.equal(sha(readFileSync(`${release.root}/${file}`)), hash);
  assert.deepEqual(read(`${release.root}/backend.json`), candidate.backend);
  assert.deepEqual(read(`${release.root}/frontend.json`), candidate.frontend);
  assert.equal(readFileSync(`${release.root}/runtime-config.js`, 'utf8'), candidate.runtime);
  assert.equal(readFileSync(`${release.root}/nginx.conf`, 'utf8'), candidate.nginx);
  const manifest = read(`/var/backups/barber-staging/export/${started.backupId}/manifest.json`);
  assert.equal(manifest.sha256, 'd491407ad12e44ebd0d7dd11a8880e7a0bb333c2c311b608b6fd9d7c5cb701d0');
  const age = Date.now() - Date.parse(manifest.createdAt); assert.ok(age >= 0 && age < 6 * 3600000);
  for (const prefix of ['restore', 'candidate-rehearsal']) {
    const recovery = read(`${INSTALL_ROOT}/${prefix}-${started.backupId}.json`);
    assert.equal(recovery.backupId, started.backupId); assert.equal(recovery.temporaryResourcesCleaned, true);
    assert.equal(recovery.originalServicesUnchanged, true); assert.equal(recovery.liveVolumesOverwritten, false);
    if (prefix === 'candidate-rehearsal') assert.equal(recovery.candidateFunctionsImage, release.functions);
  }
  docker = localDockerProbe();
  const inspect = name => JSON.parse(docker(['inspect', name]))[0];
  const inventory = () => docker(['ps', '--format', '{{.ID}} {{.Names}} {{.Image}}']).split('\n')
    .filter(line => line && ![`${PROJECT}-functions`, `${PROJECT}-api-gw`, release.frontendProject].includes(line.split(' ')[1])).sort();
  assert.deepEqual(inventory(), started.existingNonTargetContainers);
  for (const service of Object.values(original.services)) {
    const state = inspect(service.container_name);
    assert.equal(state.Config.Labels[OWNER_LABEL], APPROVED_SOURCE);
    assert.equal(state.Config.Image, service.image); assert.equal(state.State.Running, true);
    if (state.State.Health) assert.equal(state.State.Health.Status, 'healthy');
    assert.deepEqual(Object.keys(state.HostConfig.PortBindings || {}), []);
    assert.deepEqual(Object.keys(state.NetworkSettings.Networks), [PROJECT]);
    for (const [key, value] of Object.entries(service.environment || {})) assert.ok(state.Config.Env.includes(`${key}=${value}`));
  }
  const priorFront = inspect(release.frontendProject);
  assert.equal(priorFront.Config.Labels['cloud.malabdullah.barber.manual-first-release'], release.commit);
  assert.equal(priorFront.Config.Image, release.frontend);
  assert.deepEqual(Object.keys(priorFront.NetworkSettings.Networks), [release.frontendProject]);
  for (const network of [PROJECT, release.frontendProject]) assert.equal(JSON.parse(docker(['network', 'inspect', network]))[0].Internal, true);
  for (const image of [release.frontend, release.functions]) {
    const state = JSON.parse(docker(['image', 'inspect', image]))[0];
    assert.equal(state.Architecture, 'amd64'); assert.ok(state.RepoDigests.includes(image));
  }
  candidate.backend.services['api-gw'].ports = [];
  candidate.frontend.services.frontend.ports = [];
  frontend = candidate.frontend;
  const reverted = structuredClone(candidate.backend);
  reverted.services.functions.image = original.services.functions.image;
  assert.deepEqual(reverted, original);
  compose = (model, args) => docker(['compose', '--project-directory', INSTALL_ROOT, '-p', model.name, '-f', '-', ...args],
    { input: JSON.stringify(model), timeout: 240000 });
  if (process.argv[2] === '--preflight-only') {
    console.log(JSON.stringify({ status: 'private-origin-preflight-passed', commit: release.commit, mutated: false }));
    process.exit(0);
  }
  stage = 'record recovery attempt';
  const record = { ...started, resumedAt: new Date().toISOString(), previousAttempt: 'loopback-publication-failed-targets-rolled-back',
    originTransport: 'host-to-internal-docker-bridge', publishedPorts: false };
  for (const [file, value] of Object.entries({ 'backend.private-origin.json': candidate.backend,
    'frontend.private-origin.json': frontend, 'private-origin-started.json': record })) {
    writeFileSync(`${release.root}/${file}`, JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 });
  }
  stage = 'targeted Functions and frontend update'; mutated = true;
  compose(candidate.backend, ['up', '-d', '--no-deps', '--no-build', '--pull', 'never', '--wait', '--wait-timeout', '180', 'functions']);
  compose(frontend, ['up', '-d', '--no-build', '--pull', 'never', '--wait', '--wait-timeout', '90']);
  stage = 'private origin validation';
  const origins = {};
  for (const [role, name, network, port] of [['frontend', release.frontendProject, release.frontendProject, 8080],
    ['api', `${PROJECT}-api-gw`, PROJECT, 8000]]) {
    const state = inspect(name); assert.equal(state.State.Running, true);
    assert.deepEqual(Object.keys(state.HostConfig.PortBindings || {}), []);
    assert.ok(Object.values(state.NetworkSettings.Ports || {}).every(value => value === null));
    assert.deepEqual(Object.keys(state.NetworkSettings.Networks), [network]);
    const ip = state.NetworkSettings.Networks[network].IPAddress;
    assert.match(ip, /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/);
    origins[role] = `http://${ip}:${port}`;
  }
  assert.equal(inspect(`${PROJECT}-functions`).Config.Image, release.functions);
  assert.equal(inspect(release.frontendProject).Config.Image, release.frontend);
  const health = await fetch(`${origins.frontend}/healthz`, { signal: AbortSignal.timeout(10000) });
  assert.equal(health.status, 200); assert.equal((await health.text()).trim(), 'ok');
  const runtime = await fetch(`${origins.frontend}/runtime-config.js`, { signal: AbortSignal.timeout(10000) });
  assert.equal(await runtime.text(), candidate.runtime); assert.equal(runtime.headers.get('x-robots-tag'), 'noindex, nofollow');
  const auth = await fetch(`${origins.api}/auth/v1/health`, { headers: { apikey: original.services.functions.environment.SUPABASE_ANON_KEY }, signal: AbortSignal.timeout(10000) });
  assert.equal(auth.status, 200); await auth.arrayBuffer();
  assert.deepEqual(inventory(), started.existingNonTargetContainers);
  writeFileSync(`${release.root}/origin-verified.json`, JSON.stringify({ ...record, origins,
    status: 'private-origins-verified', verifiedAt: new Date().toISOString(), publicRoutingChanged: false,
    releaseAccepted: false, databaseReset: false, nonTargetContainersUnchanged: true }, null, 2), { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ status: 'private-origins-verified', commit: release.commit, origins, publicRoutingChanged: false, releaseAccepted: false }));
} catch (error) {
  console.error(`Manual resume failed at: ${stage}; no release acceptance claimed.`); process.exitCode = 1;
  const location = String(error?.stack || '').match(/resume-manual-staging-first-release(?:-v\d+)?\.mjs:(\d+):(\d+)/);
  if (location) console.error(`Operator check location: line ${location[1]}, column ${location[2]}.`);
  if (mutated && compose) {
    try {
      compose(frontend, ['stop', '--timeout', '15', 'frontend']);
      compose(original, ['up', '-d', '--no-deps', '--no-build', '--pull', 'never', '--wait', '--wait-timeout', '180', 'functions']);
      console.error('Original Functions restored; frontend stopped; evidence preserved.');
    } catch { console.error('Targeted rollback requires operator attention.'); }
  }
}
