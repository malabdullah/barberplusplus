// New format only. Historical v1/v2 validators keep their exact release bindings.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { packPrivateBackup, unpackPrivateBackup, BACKUP_LIMIT, checksum } from './staging-private-backup-format.mjs';
import { LIVE_FILES, validateRoutes } from './staging-live-backup-format.mjs';
import { validateTestCandidate, candidateIdentity, parseTestRuntime } from './test-environment-policy.mjs';
import { INSTALL_ROOT, PROJECT, SERVICES } from './staging-private-model.mjs';
import { manualFirstRelease as release } from './staging-manual-first-release.mjs';

export function packTestCheckpoint(parts, metadata, candidate) {
  validateTestCandidate(candidate);
  const legacy = JSON.parse(packPrivateBackup(Object.fromEntries(Object.entries(parts).filter(([name]) => !LIVE_FILES.includes(name))), metadata));
  const entries = { ...legacy.entries };
  for (const name of LIVE_FILES) {
    assert.ok(Buffer.isBuffer(parts[name]) && parts[name].length > 0);
    entries[name] = { sha256: checksum(parts[name]), data: parts[name].toString('base64') };
  }
  const bundle = Buffer.from(JSON.stringify({ kind: 'barber-test-checkpoint/v3', metadata: { ...metadata, candidate,
    candidateIdentity: candidateIdentity(candidate), liveFiles: Object.fromEntries(LIVE_FILES.map(name => [name, entries[name].sha256])) }, entries }));
  unpackTestCheckpoint(bundle); return bundle;
}
export function unpackTestCheckpoint(bytes) {
  assert.ok(Buffer.isBuffer(bytes) && bytes.length <= BACKUP_LIMIT);
  const bundle = JSON.parse(bytes); assert.equal(bundle.kind, 'barber-test-checkpoint/v3');
  assert.deepEqual(Object.keys(bundle).sort(), ['entries', 'kind', 'metadata']);
  const candidate = validateTestCandidate(bundle.metadata.candidate);
  assert.equal(bundle.metadata.candidateIdentity, candidateIdentity(candidate));
  assert.deepEqual(Object.keys(bundle.metadata.liveFiles).sort(), [...LIVE_FILES].sort());
  const remaining = { ...bundle.entries }; const live = {};
  for (const name of LIVE_FILES) {
    const entry = remaining[name]; assert.ok(entry); assert.deepEqual(Object.keys(entry).sort(), ['data', 'sha256']);
    const data = Buffer.from(entry.data, 'base64'); assert.ok(data.length && data.toString('base64') === entry.data);
    assert.equal(checksum(data), entry.sha256); assert.equal(entry.sha256, bundle.metadata.liveFiles[name]);
    live[name] = data; delete remaining[name];
  }
  const legacy = unpackPrivateBackup(Buffer.from(JSON.stringify({ kind: 'barber-staging-eight-service-backup/v1', metadata: bundle.metadata, entries: remaining })));
  const backend = JSON.parse(live['live/backend.json']); const frontend = JSON.parse(live['live/frontend.json']);
  assert.equal(backend.name, PROJECT); assert.equal(frontend.name, release.frontendProject);
  assert.deepEqual(Object.keys(backend.services).sort(), [...SERVICES].sort()); assert.deepEqual(Object.keys(frontend.services), ['frontend']);
  assert.deepEqual(Object.keys(backend.volumes).sort(), ['config', 'data', 'storage']);
  for (const [key, volume] of Object.entries(backend.volumes)) assert.equal(volume.name, `${PROJECT}-${key}`);
  assert.ok(!frontend.volumes || Object.keys(frontend.volumes).length === 0);
  const configurations = { bootstrap: checksum(legacy.entries['compose.private.json']), backend: checksum(live['live/backend.json']),
    frontend: checksum(live['live/frontend.json']), runtime: checksum(live['live/runtime-config.js']), nginx: checksum(live['live/nginx.conf']) };
  assert.deepEqual(configurations, candidate.configuration);
  for (const model of [backend, frontend]) {
    assert.equal(model.networks.default.internal, true); assert.equal(model.networks.default.name, model.name);
    assert.deepEqual(Object.keys(model.networks), ['default']);
    for (const [name, service] of Object.entries(model.services)) {
      assert.equal(service.image, candidate.images[name]); assert.equal(service.platform, 'linux/amd64');
      assert.equal(service.container_name, name === 'frontend' ? release.frontendProject : `${PROJECT}-${name}`);
      assert.deepEqual(service.ports, []); assert.deepEqual(service.networks, { default: {} });
      for (const key of ['privileged', 'network_mode', 'pid', 'ipc', 'devices', 'volumes_from', 'cap_add']) assert.ok(!service[key]);
      for (const mount of service.volumes) {
        if (mount.type === 'volume') assert.ok(model.volumes[mount.source]?.name.startsWith(`${PROJECT}-`));
        else {
          assert.equal(mount.type, 'bind'); assert.equal(mount.read_only, true);
          assert.ok(!mount.source.includes('..') && (name === 'frontend' ? mount.source.startsWith(`${release.root}/`) : ['db', 'api-gw'].includes(name) && mount.source.startsWith(`${INSTALL_ROOT}/${name === 'db' ? 'sql' : 'gateway'}/`)));
        }
      }
    }
  }
  const env = backend.services.functions.environment;
  assert.equal(env.APP_ENV, 'staging'); assert.equal(env.AI_OUTBOUND_ENABLED, 'false');
  for (const key of ['OPENAI_API_KEY', 'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'OUTBOUND_RECIPIENT_ALLOWLIST']) assert.equal(env[key], '');
  const runtime = parseTestRuntime(live['live/runtime-config.js'].toString());
  assert.equal(runtime.commit, candidate.commit); assert.equal(runtime.anon, env.SUPABASE_ANON_KEY); assert.notEqual(runtime.anon, env.SUPABASE_SERVICE_ROLE_KEY);
  const migrationFiles = Object.keys(legacy.entries).filter(name => name.startsWith('migrations/')).sort();
  assert.deepEqual(migrationFiles, candidate.migrations.map(m => `migrations/${m.file}`));
  for (const migration of candidate.migrations) assert.equal(checksum(legacy.entries[`migrations/${migration.file}`]), migration.sha256);
  validateRoutes(JSON.parse(live['live/routes.json']));
  assert.equal(checksum(live['live/cloudflared.service']), checksum(readFileSync(new URL('../ops/staging-vps/barber-staging-cloudflared.service', import.meta.url))));
  const connector = JSON.parse(Buffer.from(live['live/tunnel-token'].toString().trim(), 'base64'));
  assert.equal(connector.t, '890d4536-b73b-47de-be24-f45a064a79f3'); assert.equal(connector.a, '09c18affdb74c9a3721f79f6566df48a');
  assert.ok(typeof connector.s === 'string' && connector.s.length >= 20);
  return { metadata: bundle.metadata, entries: { ...legacy.entries, ...live }, model: backend, frontend, version: 3 };
}
