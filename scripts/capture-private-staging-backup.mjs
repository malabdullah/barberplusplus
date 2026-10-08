import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, rmdirSync, writeFileSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { localDockerProbe } from './local-docker-probe.mjs';
import { APPROVED_SOURCE, INSTALL_ROOT, PROJECT, OWNER_LABEL, SERVICES, validatePrivateModel } from './staging-private-model.mjs';
import { recoveryRoleQuery, validateRecoveryRole } from './staging-recovery-roles.mjs';
import { BACKUP_LIMIT, checksum, packPrivateBackup } from './staging-private-backup-format.mjs';
import { selectBackupVaultProbe } from './staging-backup-vault-probe.mjs';

const TAR_IMAGE = 'node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e';
let stage = 'backup preflight';
let compose;
let quiesced = false;
let scratch;
let captureLock = false;
let captureComplete = false;
const lockPath = '/var/backups/barber-staging/capture-in-progress';
const flush = (path) => { const fd = openSync(path, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); } };
try {
  assert.equal(hostname(), 'srv1207055'); assert.equal(process.getuid(), 0);
  assert.ok(process.argv.length === 2 || (process.argv.length === 3 && process.argv[2] === '--refresh-private-bootstrap'));
  const mode = process.argv.length === 2 ? 'bootstrap' : 'refresh-private-bootstrap';
  const model = JSON.parse(readFileSync(`${INSTALL_ROOT}/compose.private.json`)); validatePrivateModel(model);
  const prepared = JSON.parse(readFileSync(`${INSTALL_ROOT}/prepared.json`));
  assert.equal(checksum(readFileSync(`${INSTALL_ROOT}/compose.private.json`)), prepared.composeSha256);
  assert.ok(JSON.parse(readFileSync(`${INSTALL_ROOT}/functional-verified.json`)).isolationVerified);
  for (const path of ['/var/backups/barber-staging', '/var/backups/barber-staging/export', '/etc/barber-staging-backup/recipient.txt']) {
    const stat = lstatSync(path); assert.ok(!stat.isSymbolicLink() && stat.uid === 0 && (stat.mode & 0o077) === 0);
  }
  mkdirSync(lockPath, { mode: 0o700 }); captureLock = true; flush('/var/backups/barber-staging');
  const docker = localDockerProbe();
  compose = (args) => docker(['compose', '--project-directory', INSTALL_ROOT, '-p', PROJECT, '-f', '-', ...args], { input: JSON.stringify(model), timeout: 300000 });
  const sql = (input) => docker(['exec', '-i', '-u', 'postgres', `${PROJECT}-db`,
    'psql', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-d', 'postgres'], { input }).trim();
  for (const service of Object.values(model.services)) {
    const [state] = JSON.parse(docker(['inspect', service.container_name]));
    assert.equal(state.Config.Labels[OWNER_LABEL], APPROVED_SOURCE);
    assert.equal(state.Config.Image, service.image);
    for (const [key, value] of Object.entries(service.environment || {})) {
      assert.ok(state.Config.Env.includes(`${key}=${value}`));
    }
    assert.equal(state.Mounts.filter(mount => mount.Type !== 'tmpfs').length, service.volumes.length);
    assert.deepEqual(Object.keys(state.HostConfig.Tmpfs || {}).sort(), (service.tmpfs || []).map(value => value.split(':')[0]).sort());
    for (const mount of service.volumes) {
      const actual = state.Mounts.find(item => item.Destination === mount.target);
      assert.ok(actual && actual.Type === mount.type);
      if (mount.type === 'volume') assert.equal(actual.Name, model.volumes[mount.source].name);
      else { assert.equal(actual.Source, mount.source); assert.equal(actual.RW, false); }
    }
    assert.deepEqual(Object.keys(state.HostConfig.PortBindings || {}), []);
    assert.deepEqual(Object.keys(state.NetworkSettings.Networks), [PROJECT]);
    assert.equal(state.State.Running, true);
    if (state.State.Health) assert.equal(state.State.Health.Status, 'healthy');
  }
  for (const volume of Object.values(model.volumes)) assert.equal(JSON.parse(docker(['volume', 'inspect', volume.name]))[0].Labels[OWNER_LABEL], APPROVED_SOURCE);
  const [network] = JSON.parse(docker(['network', 'inspect', PROJECT]));
  assert.equal(network.Internal, true); assert.equal(network.Labels[OWNER_LABEL], APPROVED_SOURCE);
  assert.equal(sql('SHOW cron.launch_active_jobs;'), 'off');
  const vaultProbe = selectBackupVaultProbe(mode, sql);
  const createdAt = new Date().toISOString();
  const id = `staging-${createdAt.slice(0, 19).replaceAll('-', '').replaceAll(':', '')}Z-${randomBytes(4).toString('hex')}`;
  const exportRoot = '/var/backups/barber-staging/export';
  for (const path of ['/var/backups/barber-staging', exportRoot, '/etc/barber-staging-backup/recipient.txt']) {
    const stat = lstatSync(path); assert.ok(!stat.isSymbolicLink() && stat.uid === 0 && (stat.mode & 0o077) === 0);
  }
  stage = 'quiesce all application writers';
  quiesced = true;
  compose(['stop', '--timeout', '15', ...SERVICES.filter((name) => name !== 'db')]);
  stage = 'consistent data capture';
  const recoveryRole = validateRecoveryRole(JSON.parse(sql(recoveryRoleQuery)));
  const counts = JSON.parse(sql("SELECT json_build_object('users',(SELECT count(*) FROM auth.users),'branches',(SELECT count(*) FROM public.branches),'objects',(SELECT count(*) FROM storage.objects),'migrations',(SELECT count(*) FROM supabase_migrations.schema_migrations));"));
  const database = docker(['exec', '-u', 'postgres', `${PROJECT}-db`, 'pg_dump', '-U', 'supabase_admin', '-d', 'postgres', '--format=custom'], { encoding: null, maxBuffer: BACKUP_LIMIT });
  const helper = `${PROJECT}-backup-storage`;
  assert.equal(docker(['ps', '-aq', '--filter', `name=^/${helper}$`]), '');
  const storage = docker(['run', '--rm', '--name', helper, '--network', 'none', '--read-only',
    '--label', `${OWNER_LABEL}=${APPROVED_SOURCE}`, '--platform', 'linux/amd64',
    '--cap-drop', 'ALL', '--cap-add', 'CHOWN', '--cap-add', 'FOWNER', '--cap-add', 'DAC_OVERRIDE',
    '--security-opt', 'no-new-privileges', '--memory', '256m', '--cpus', '0.5', '--pids-limit', '64',
    '--mount', `type=volume,src=${model.volumes.storage.name},dst=/data,readonly`,
    '--entrypoint', 'tar', TAR_IMAGE, '--xattrs', '--xattrs-include=user.*', '--acls', '--numeric-owner', '-C', '/data', '-cpf', '-', '.'],
  { encoding: null, maxBuffer: BACKUP_LIMIT, timeout: 60000 });
  compose(['stop', '--timeout', '15', 'db']);
  const databaseConfig = docker(['cp', `${PROJECT}-db:/etc/postgresql-custom/.`, '-'], { encoding: null, maxBuffer: BACKUP_LIMIT });
  const paths = ['compose.private.json', 'synthetic-accounts.json', 'synthetic-integration.json', 'seed.private.sql',
    'prepared.json', 'initialized.json', 'functional-verified.json', 'security-tests.sql',
    ...Object.keys(prepared.publicFiles), ...Object.keys(prepared.migrations).map((name) => `migrations/${name}`)];
  const parts = Object.fromEntries(paths.map((path) => [path, readFileSync(`${INSTALL_ROOT}/${path}`)]));
  Object.assign(parts, { 'database.dump': database, 'storage.tar': storage, 'database-config.tar': databaseConfig });
  const bundle = packPrivateBackup(parts, { id, source: APPROVED_SOURCE, host: hostname(), createdAt, counts,
    recoveryRole, vaultProbe, scope: 'all-eight-service-config-and-three-persistent-volumes',
    ephemeralExclusions: ['Mailpit tmpfs inbox', 'Realtime connections/cache', 'Functions tmpfs'],
    imageAvailability: 'exact source candidate images retained on VPS and Mac; application registry release verified separately', mode });
  stage = 'owner-recipient encryption';
  scratch = mkdtempSync(join(tmpdir(), 'barber-private-capture-'));
  writeFileSync(join(scratch, 'bundle.json'), bundle, { flag: 'wx', mode: 0o600 });
  const archive = execFileSync('/usr/bin/tar', ['-C', scratch, '-cf', '-', 'bundle.json'], { maxBuffer: BACKUP_LIMIT, stdio: ['ignore', 'pipe', 'pipe'] });
  const ciphertext = execFileSync('/usr/bin/age', ['-R', '/etc/barber-staging-backup/recipient.txt'], { input: archive, maxBuffer: BACKUP_LIMIT, stdio: ['pipe', 'pipe', 'pipe'] });
  const directory = `${exportRoot}/${id}`;
  mkdirSync(directory, { mode: 0o700 });
  writeFileSync(`${directory}/payload.tar.age`, ciphertext, { flag: 'wx', mode: 0o600 });
  flush(`${directory}/payload.tar.age`); flush(directory); flush(exportRoot);
  stage = 'resume private services';
  compose(['up', '-d', '--no-recreate', '--wait', '--wait-timeout', '240']);
  quiesced = false;
  const manifest = { version: 1, id, environment: 'staging', sourceHost: 'srv1207055', kind: 'staging-backup',
    file: 'payload.tar.age', sha256: checksum(ciphertext), bytes: ciphertext.length, createdAt };
  // Publish manifest last, only after consistent capture/encryption and resumption.
  writeFileSync(`${directory}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  flush(`${directory}/manifest.json`); flush(directory);
  captureComplete = true;
  console.log(JSON.stringify({ id, bytes: ciphertext.length, sha256: manifest.sha256, counts,
    capture: 'encrypted-eight-service-state-captured', offHostVerified: false, restoreVerified: false }));
} catch {
  console.error(`Private staging backup failed at: ${stage}. No successful backup receipt claimed.`);
  process.exitCode = 1;
} finally {
  if (quiesced && compose) {
    try { compose(['up', '-d', '--no-recreate', '--wait', '--wait-timeout', '240']); console.log('Private staging services resumed after capture attempt.'); }
    catch { console.error('Private staging service resumption requires attention.'); process.exitCode = 1; }
  }
  if (scratch) rmSync(scratch, { recursive: true });
  // Failure/crash is never silently retried. Keep the lock for manual review
  // even when finally successfully resumed services after a failed capture.
  if (captureLock && captureComplete && !quiesced) {
    rmdirSync(lockPath); flush('/var/backups/barber-staging');
  }
}
