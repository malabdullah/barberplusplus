// One-shot operator for the separately owner-approved manual release only.
// Never called by a workflow, timer, broker or unprivileged deployment identity.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, existsSync, lstatSync, chmodSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { hostname } from 'node:os';
import { createServer } from 'node:net';
import { localDockerProbe } from './local-docker-probe.mjs';
import { prepareManualFirstRelease, manualFirstRelease as release } from './staging-manual-first-release.mjs';
import { INSTALL_ROOT, PROJECT, OWNER_LABEL, APPROVED_SOURCE } from './staging-private-model.mjs';

const backupId = 'staging-20261008T091500Z-be276ae2';
const sha = value => createHash('sha256').update(value).digest('hex');
let stage = 'preflight'; let mutated = false; let frontCreated = false; let docker; let original; let front; let compose;
const label = 'cloud.malabdullah.barber.manual-first-release';
try {
  assert.equal(hostname(), 'srv1207055'); assert.equal(process.getuid(), 0);
  assert.ok(process.argv.length === 3 && ['--owner-approved-6217cb3', '--preflight-only'].includes(process.argv[2]));
  assert.ok(Date.now() < Date.parse('2026-10-18T00:00:00Z'));
  const parent = lstatSync('/opt/barber-staging');
  assert.ok(parent.isDirectory() && !parent.isSymbolicLink() && parent.uid === 0 && (parent.mode & 0o022) === 0);
  assert.equal(existsSync(release.root), false);
  const source = readFileSync(`${INSTALL_ROOT}/compose.private.json`);
  const prepared = JSON.parse(readFileSync(`${INSTALL_ROOT}/prepared.json`));
  assert.equal(sha(source), prepared.composeSha256);
  original = JSON.parse(source);
  const candidate = prepareManualFirstRelease(original, {
    runtime: readFileSync(new URL('../docker/runtime-config.js.template', import.meta.url), 'utf8'),
    nginx: readFileSync(new URL('../docker/nginx.conf.template', import.meta.url), 'utf8'),
  });
  front = candidate.frontend;
  const manifest = JSON.parse(readFileSync(`/var/backups/barber-staging/export/${backupId}/manifest.json`));
  assert.equal(manifest.sha256, 'd491407ad12e44ebd0d7dd11a8880e7a0bb333c2c311b608b6fd9d7c5cb701d0');
  const age = Date.now() - Date.parse(manifest.createdAt);
  assert.ok(age >= 0 && age < 6 * 3600000);
  for (const prefix of ['restore', 'candidate-rehearsal']) {
    const receipt = JSON.parse(readFileSync(`${INSTALL_ROOT}/${prefix}-${backupId}.json`));
    assert.equal(receipt.backupId, backupId);
    assert.equal(receipt.temporaryResourcesCleaned, true);
    assert.equal(receipt.originalServicesUnchanged, true);
    assert.equal(receipt.liveVolumesOverwritten, false);
    if (prefix === 'candidate-rehearsal') assert.equal(receipt.candidateFunctionsImage, release.functions);
  }
  for (const [file, hash] of Object.entries(prepared.migrations)) {
    assert.equal(sha(readFileSync(`${INSTALL_ROOT}/migrations/${file}`)), hash);
  }
  docker = localDockerProbe();
  compose = (model, args) => docker(['compose', '--project-directory', INSTALL_ROOT,
    '-p', model.name, '-f', '-', ...args], { input: JSON.stringify(model), timeout: 240000 });
  const inventory = () => docker(['ps', '--format', '{{.ID}} {{.Names}} {{.Image}}']).split('\n')
    .filter(line => line && ![`${PROJECT}-functions`, `${PROJECT}-api-gw`, release.frontendProject].includes(line.split(' ')[1])).sort();
  const before = inventory();
  for (const service of Object.values(original.services)) {
    const [state] = JSON.parse(docker(['inspect', service.container_name]));
    assert.equal(state.Config.Labels[OWNER_LABEL], APPROVED_SOURCE);
    assert.equal(state.Config.Image, service.image); assert.equal(state.State.Running, true);
    if (state.State.Health) assert.equal(state.State.Health.Status, 'healthy');
    assert.deepEqual(Object.keys(state.HostConfig.PortBindings || {}), []);
    assert.deepEqual(Object.keys(state.NetworkSettings.Networks), [PROJECT]);
    for (const [key, value] of Object.entries(service.environment || {})) assert.ok(state.Config.Env.includes(`${key}=${value}`));
  }
  for (const image of [release.frontend, release.functions]) {
    const [metadata] = JSON.parse(docker(['image', 'inspect', image]));
    assert.equal(metadata.Architecture, 'amd64'); assert.ok(metadata.RepoDigests.includes(image));
  }
  assert.equal(docker(['ps', '-aq', '--filter', `name=^/${release.frontendProject}$`]), '');
  assert.equal(docker(['network', 'ls', '-q', '--filter', `name=^${release.frontendProject}$`]), '');
  for (const port of [18080, 54331]) await new Promise((resolve, reject) => {
    const server = createServer(); server.once('error', reject);
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
  const versions = docker(['exec', '-u', 'postgres', `${PROJECT}-db`, 'psql', '-X', '-A', '-t', '-d', 'postgres',
    '-c', 'SELECT version FROM supabase_migrations.schema_migrations ORDER BY version;']).split('\n');
  assert.deepEqual(versions, Object.keys(prepared.migrations).map(file => file.split('_')[0]).sort());
  if (process.argv[2] === '--preflight-only') {
    console.log(JSON.stringify({ status: 'manual-release-preflight-passed', commit: release.commit, backupId, mutated: false }));
    process.exit(0);
  }
  stage = 'exclusive configuration preparation';
  mkdirSync(release.root, { mode: 0o700 });
  const files = { 'backend.json': JSON.stringify(candidate.backend), 'frontend.json': JSON.stringify(front),
    'runtime-config.js': candidate.runtime, 'nginx.conf': candidate.nginx };
  for (const [name, data] of Object.entries(files)) {
    const mode = name.endsWith('.json') ? 0o600 : 0o644;
    writeFileSync(`${release.root}/${name}`, data, { flag: 'wx', mode }); chmodSync(`${release.root}/${name}`, mode);
  }
  const receipt = { release, backupId, approvedProcedure: 'owner-approved-manual-first-release',
    automatedEnvelopeConsumed: false, automationEnabled: false, startedAt: new Date().toISOString(),
    files: Object.fromEntries(Object.entries(files).map(([name, data]) => [name, sha(data)])),
    originalComposeSha256: sha(source), migrations: prepared.migrations, existingNonTargetContainers: before };
  writeFileSync(`${release.root}/started.json`, JSON.stringify(receipt, null, 2), { flag: 'wx', mode: 0o600 });
  stage = 'targeted Functions and gateway update'; mutated = true;
  compose(candidate.backend, ['up', '-d', '--no-deps', '--no-build', '--pull', 'never', '--wait', '--wait-timeout', '180', 'functions', 'api-gw']);
  stage = 'isolated frontend startup'; frontCreated = true;
  compose(front, ['up', '-d', '--no-build', '--pull', 'never', '--wait', '--wait-timeout', '90']);
  stage = 'loopback health and identity verification';
  for (const [name, port, target] of [[release.frontendProject, '18080', '8080/tcp'], [`${PROJECT}-api-gw`, '54331', '8000/tcp']]) {
    const [state] = JSON.parse(docker(['inspect', name]));
    assert.equal(state.State.Running, true);
    assert.deepEqual(state.HostConfig.PortBindings, { [target]: [{ HostIp: '127.0.0.1', HostPort: port }] });
  }
  assert.equal(JSON.parse(docker(['inspect', `${PROJECT}-functions`]))[0].Config.Image, release.functions);
  assert.equal(JSON.parse(docker(['inspect', release.frontendProject]))[0].Config.Image, release.frontend);
  assert.equal(JSON.parse(docker(['network', 'inspect', release.frontendProject]))[0].Internal, true);
  const health = await fetch('http://127.0.0.1:18080/healthz', { signal: AbortSignal.timeout(10000) });
  assert.equal(health.status, 200); assert.equal((await health.text()).trim(), 'ok');
  const runtime = await fetch('http://127.0.0.1:18080/runtime-config.js');
  assert.equal(await runtime.text(), candidate.runtime);
  assert.equal(runtime.headers.get('x-robots-tag'), 'noindex, nofollow');
  const auth = await fetch('http://127.0.0.1:54331/auth/v1/health', {
    headers: { apikey: original.services.functions.environment.SUPABASE_ANON_KEY }, signal: AbortSignal.timeout(10000) });
  assert.equal(auth.status, 200); await auth.arrayBuffer();
  assert.deepEqual(inventory(), before);
  writeFileSync(`${release.root}/origin-verified.json`, JSON.stringify({ ...receipt,
    verifiedAt: new Date().toISOString(), status: 'loopback-origin-verified', publicRoutingChanged: false,
    releaseAccepted: false, databaseReset: false, nonTargetContainersUnchanged: true }, null, 2), { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ status: 'loopback-origin-verified', commit: release.commit, backupId,
    nonTargetContainersUnchanged: true, publicRoutingChanged: false, releaseAccepted: false }));
} catch {
  console.error(`Manual release failed at: ${stage}. No release acceptance claimed.`); process.exitCode = 1;
  if (mutated && compose) {
    try {
      if (frontCreated) {
        const ids = docker(['ps', '-aq', '--filter', `name=^/${release.frontendProject}$`]);
        if (ids) {
          assert.equal(JSON.parse(docker(['inspect', ids]))[0].Config.Labels[label], release.commit);
          compose(front, ['stop', '--timeout', '15', 'frontend']);
        }
      }
      compose(original, ['up', '-d', '--no-deps', '--no-build', '--pull', 'never', '--wait', '--wait-timeout', '180', 'functions', 'api-gw']);
      console.error('Original Functions/gateway restored; new frontend stopped, files preserved for review.');
    } catch { console.error('Targeted rollback requires operator attention.'); }
  }
}
