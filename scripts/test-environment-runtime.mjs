// Fixed VPS inventory only. Never print private models, keys or account values.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statfsSync } from 'node:fs';
import { hostname } from 'node:os';
import { execFileSync } from 'node:child_process';
import { INSTALL_ROOT, PROJECT, SERVICES } from './staging-private-model.mjs';
import { manualFirstRelease as release } from './staging-manual-first-release.mjs';
import { readProtected, privateRoot, resourceLimitBytes } from './staging-live-context.mjs';
import { checksum } from './staging-private-backup-format.mjs';
import { LIVE_ROUTES } from './staging-live-backup-format.mjs';
import { localDockerProbe } from './local-docker-probe.mjs';
import { validateTestCandidate, candidateIdentity, validateTestState, boundedMaintenance, parseTestRuntime } from './test-environment-policy.mjs';
import { TEST_STATE_ROOT, OPERATION_LOCK, readTestJson, protectedTestPath } from './test-environment-state.mjs';

export function observedTestRuntime({ includePrivate = false } = {}) {
  assert.equal(hostname(), 'srv1207055'); assert.equal(process.platform, 'linux'); assert.equal(process.getuid(), 0);
  privateRoot(INSTALL_ROOT); privateRoot(release.root);
  const locations = { backend: `${release.root}/backend.private-origin.json`, frontend: `${release.root}/frontend.same-origin.json`,
    runtime: `${release.root}/runtime-config.same-origin.js`, nginx: `${release.root}/nginx.same-origin.conf`, bootstrap: `${INSTALL_ROOT}/compose.private.json` };
  const files = Object.fromEntries(Object.entries(locations).map(([key, path]) => [key, readProtected(path)]));
  const backend = JSON.parse(files.backend); const frontend = JSON.parse(files.frontend);
  assert.equal(backend.name, PROJECT); assert.equal(frontend.name, release.frontendProject);
  assert.deepEqual(Object.keys(backend.services).sort(), [...SERVICES].sort()); assert.deepEqual(Object.keys(frontend.services), ['frontend']);
  assert.deepEqual(Object.keys(backend.volumes).sort(), ['config', 'data', 'storage']);
  for (const [key, volume] of Object.entries(backend.volumes)) assert.equal(volume.name, `${PROJECT}-${key}`);
  const runtime = parseTestRuntime(files.runtime.toString()); const commit = runtime.commit;
  // The browser derives its WSS origin from the same HTTPS Supabase origin.
  const functions = backend.services.functions.environment;
  assert.equal(runtime.anon, functions.SUPABASE_ANON_KEY); assert.notEqual(runtime.anon, functions.SUPABASE_SERVICE_ROLE_KEY);
  assert.equal(functions.APP_ENV, 'staging'); assert.equal(functions.APP_URL, release.appUrl);
  assert.equal(functions.SUPABASE_URL, 'http://api-gw:8000'); assert.equal(functions.AI_OUTBOUND_ENABLED, 'false');
  for (const key of ['OPENAI_API_KEY', 'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'OUTBOUND_RECIPIENT_ALLOWLIST']) assert.equal(functions[key], '');
  assert.equal(backend.services.auth.environment.GOTRUE_SMTP_HOST, 'mailpit');
  const docker = localDockerProbe(); const states = []; const origins = {};
  const claims = JSON.parse(Buffer.from(functions.SUPABASE_SERVICE_ROLE_KEY.split('.')[1], 'base64url'));
  assert.equal(claims.role, 'service_role'); assert.ok(Number.isSafeInteger(claims.exp));
  for (const model of [backend, frontend]) {
    const [network] = JSON.parse(docker(['network', 'inspect', model.name])); assert.equal(network.Internal, true);
    for (const [name, service] of Object.entries(model.services)) {
      assert.equal(service.container_name, name === 'frontend' ? release.frontendProject : `${PROJECT}-${name}`);
      const [actual] = JSON.parse(docker(['inspect', service.container_name]));
      assert.equal(actual.Config.Image, service.image);
      assert.deepEqual(Object.keys(actual.NetworkSettings.Networks), [model.name]);
      assert.deepEqual(Object.keys(actual.HostConfig.PortBindings || {}), []); assert.equal(actual.HostConfig.Privileged, false);
      assert.deepEqual(actual.HostConfig.CapAdd || [], []);
      for (const [key, value] of Object.entries(service.environment || {})) assert.ok(actual.Config.Env.includes(`${key}=${value}`));
      for (const [key, value] of Object.entries(service.labels || {})) assert.equal(actual.Config.Labels[key], value);
      if (service.user) assert.equal(actual.Config.User, service.user);
      if (service.read_only) assert.equal(actual.HostConfig.ReadonlyRootfs, true);
      if (service.cap_drop) assert.deepEqual(actual.HostConfig.CapDrop, service.cap_drop);
      if (service.security_opt) assert.deepEqual(actual.HostConfig.SecurityOpt, service.security_opt);
      assert.equal(actual.HostConfig.Memory, resourceLimitBytes(service.mem_limit));
      assert.equal(actual.HostConfig.NanoCpus, Math.round(service.cpus * 1e9)); assert.equal(actual.HostConfig.PidsLimit, service.pids_limit);
      const mounts = actual.Mounts.filter(m => m.Type !== 'tmpfs'); assert.equal(mounts.length, service.volumes.length);
      for (const mount of service.volumes) {
        const found = mounts.find(m => m.Destination === mount.target); assert.ok(found); assert.equal(found.Type, mount.type);
        if (mount.type === 'volume') {
          const expected = model.volumes[mount.source]; assert.equal(found.Name, expected.name); assert.ok(expected.name.startsWith(`${PROJECT}-`));
          const [volume] = JSON.parse(docker(['volume', 'inspect', found.Name]));
          for (const [key, value] of Object.entries(expected.labels)) assert.equal(volume.Labels[key], value);
        } else { assert.equal(found.Source, mount.source); assert.equal(found.RW, false); }
      }
      states.push({ service: name, name: service.container_name, image: service.image, running: actual.State.Running,
        health: actual.State.Health?.Status || (actual.State.Running ? 'running' : 'stopped'), restarts: actual.RestartCount, oom: actual.State.OOMKilled });
      if (name === 'api-gw') origins.api = `http://${actual.NetworkSettings.Networks[model.name].IPAddress}:8000`;
      if (name === 'frontend') origins.frontend = `http://${actual.NetworkSettings.Networks[model.name].IPAddress}:8080`;
    }
  }
  const migrations = readdirSync(`${INSTALL_ROOT}/migrations`).sort().map(file => {
    assert.match(file, /^\d{14}_[a-z0-9_]+\.sql$/); return { file, sha256: checksum(readProtected(`${INSTALL_ROOT}/migrations/${file}`)) };
  });
  const candidate = validateTestCandidate({ schema: 'barber-test-candidate/v1', host: 'srv1207055', environment: 'staging', commit,
    images: Object.fromEntries(states.map(s => [s.service, s.image])), configuration: Object.fromEntries(Object.entries(files).map(([k, data]) => [k, checksum(data)])), migrations });
  const dbRunning = states.find(s => s.service === 'db').running;
  let syntheticOnly = null;
  if (dbRunning) {
    const sql = input => docker(['exec', '-i', '-u', 'postgres', `${PROJECT}-db`, 'psql', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-d', 'postgres'], { input });
    assert.equal(sql('SHOW cron.launch_active_jobs;'), 'off');
    const versions = JSON.parse(sql("SELECT coalesce(json_agg(version ORDER BY version),'[]') FROM supabase_migrations.schema_migrations;"));
    assert.deepEqual(versions, migrations.map(m => m.file.slice(0, 14)));
    syntheticOnly = sql("SELECT count(*) FROM auth.users WHERE email IS NULL OR email !~ '@barber\\.test$';") === '0';
  }
  const disk = statfsSync('/var/backups/barber-staging');
  const tunnel = execFileSync('/usr/bin/systemctl', ['show', '-p', 'ActiveState', '--value', 'barber-staging-cloudflared.service'], { encoding: 'utf8' }).trim();
  const result = { version: 1, host: 'srv1207055', inspectedAt: new Date().toISOString(), candidate, candidateIdentity: candidateIdentity(candidate), states,
    origins, originMatch: JSON.stringify(origins) === JSON.stringify(LIVE_ROUTES.origins), syntheticOnly, outboundDisabled: true, cloudflared: tunnel,
    diskPercent: Math.round(100 * (disk.blocks - disk.bavail) / disk.blocks), serviceKeyExpiresAt: new Date(claims.exp * 1000).toISOString() };
  if (includePrivate) {
    const prepared = JSON.parse(readProtected(`${INSTALL_ROOT}/prepared.json`));
    const sql = input => docker(['exec', '-i', '-u', 'postgres', `${PROJECT}-db`, 'psql', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-d', 'postgres'], { input });
    return { ...result, original: JSON.parse(files.bootstrap), backend, frontend, prepared, docker, sql,
      states: states.map(state => {
        const [actual] = JSON.parse(docker(['inspect', state.name]));
        return { id: actual.Id, name: state.name, image: state.image, healthcheck: Boolean(actual.State.Health) };
      }) };
  }
  return result;
}
export function testCheckpointContext() {
  const inventory = testInventory();
  assert.ok(inventory.states.every(s => s.running && ['healthy', 'running'].includes(s.health) && !s.oom));
  const context = observedTestRuntime({ includePrivate: true });
  assert.equal(context.candidateIdentity, candidateIdentity(readTestJson('runtime.json')));
  assert.ok(context.originMatch && context.syntheticOnly);
  return context;
}
export function testInventory() {
  protectedTestPath(TEST_STATE_ROOT, true);
  const expected = readTestJson('runtime.json'); validateTestCandidate(expected);
  const observed = observedTestRuntime(); assert.equal(observed.candidateIdentity, candidateIdentity(expected), 'Recorded release drift');
  const state = validateTestState(readTestJson('state.json'));
  assert.equal(candidateIdentity(state.candidate), observed.candidateIdentity, 'State/runtime drift');
  const maintenance = existsSync(`${TEST_STATE_ROOT}/maintenance.json`) ? readTestJson('maintenance.json') : null;
  if (maintenance) { boundedMaintenance(maintenance, Date.now()); assert.equal(maintenance.candidateIdentity, observed.candidateIdentity); }
  let lock = null;
  if (existsSync(OPERATION_LOCK)) {
    protectedTestPath(OPERATION_LOCK, true);
    const journal = JSON.parse(readFileSync(protectedTestPath(`${OPERATION_LOCK}/journal.json`)));
    assert.equal(journal.version, 1); assert.ok(Number.isFinite(Date.parse(journal.createdAt)));
    lock = { createdAt: journal.createdAt, ageMs: Date.now() - Date.parse(journal.createdAt) };
  }
  const security = existsSync(`${TEST_STATE_ROOT}/security.json`) ? readTestJson('security.json') : null;
  return { ...observed, mode: state.mode, maintenance, operationLock: lock, security };
}
