import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, lstatSync, writeFileSync, rmSync, rmdirSync, statfsSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INSTALL_ROOT, PROJECT, SERVICES } from './staging-private-model.mjs';
import { manualFirstRelease as release } from './staging-manual-first-release.mjs';
import { BACKUP_LIMIT, checksum, validateBackupFile } from './staging-private-backup-format.mjs';
import { packLiveBackup, LIVE_ROUTES } from './staging-live-backup-format.mjs';
import { liveContext, privateRoot, readProtected, resumeStates, flushPath } from './staging-live-context.mjs';
import { recoveryRoleQuery, validateRecoveryRole } from './staging-recovery-roles.mjs';
import { selectBackupVaultProbe } from './staging-backup-vault-probe.mjs';
import { maintenanceWindow } from './staging-operations-policy.mjs';
import { STAGING_TAR_IMAGE } from './staging-backup-tool.mjs';

const exportRoot = '/var/backups/barber-staging/export';
const lock = '/var/backups/barber-staging/capture-in-progress';
const tarImage = STAGING_TAR_IMAGE;
let context; let stopped = false; let scratch; let complete = false; let stage = 'preflight'; let directory;
try {
  assert.ok(process.argv.length === 3 && ['--supervised', '--scheduled'].includes(process.argv[2]));
  if (process.argv[2] === '--scheduled' && !maintenanceWindow(new Date())) {
    console.error('Scheduled staging capture missed its window; no services stopped.'); process.exit(1);
  }
  context = liveContext(); const { docker, sql, states, prepared } = context;
  privateRoot('/var/backups/barber-staging'); privateRoot(exportRoot);
  const recipient = readProtected('/etc/barber-staging-backup/recipient.txt');
  assert.match(recipient.toString().trim(), /^age1[a-z0-9]+$/);
  const recipientState = lstatSync('/etc/barber-staging-backup/recipient.txt'); assert.equal(recipientState.mode & 0o077, 0);
  const disk = statfsSync(exportRoot); assert.ok(disk.bavail * disk.bsize > 512 * 1024 * 1024, 'Insufficient capture workspace');
  assert.equal(existsSync(lock), false, 'Capture/maintenance lock requires review');
  const image = JSON.parse(docker(['image', 'inspect', tarImage]))[0]; assert.equal(image.Architecture, 'amd64');
  assert.equal(sql('SHOW cron.launch_active_jobs;'), 'off');
  assert.equal(sql("SELECT count(*) FROM auth.users WHERE email IS NULL OR email !~ '@barber\\.test$';"), '0');
  const vaultProbe = selectBackupVaultProbe('refresh-private-bootstrap', sql);
  const history = JSON.parse(sql('SELECT coalesce(json_agg(version ORDER BY version),\'[]\') FROM supabase_migrations.schema_migrations;'));
  assert.deepEqual(history, Object.keys(prepared.migrations).map(name => name.slice(0, 14)).sort());
  const paths = ['compose.private.json', 'synthetic-accounts.json', 'synthetic-integration.json', 'seed.private.sql',
    'prepared.json', 'initialized.json', 'functional-verified.json', 'security-tests.sql',
    ...Object.keys(prepared.publicFiles), ...Object.keys(prepared.migrations).map(name => `migrations/${name}`)];
  const parts = {};
  for (const path of paths) { validateBackupFile(path); parts[path] = readProtected(`${INSTALL_ROOT}/${path}`); }
  for (const [name, hash] of Object.entries(prepared.migrations)) assert.equal(checksum(parts[`migrations/${name}`]), hash);
  for (const [name, hash] of Object.entries(prepared.publicFiles)) assert.equal(checksum(parts[name]), hash);
  parts['live/backend.json'] = readProtected(`${release.root}/backend.private-origin.json`);
  parts['live/frontend.json'] = readProtected(`${release.root}/frontend.same-origin.json`);
  parts['live/runtime-config.js'] = readProtected(`${release.root}/runtime-config.same-origin.js`);
  parts['live/nginx.conf'] = readProtected(`${release.root}/nginx.same-origin.conf`);
  parts['live/routes.json'] = Buffer.from(JSON.stringify(LIVE_ROUTES));
  privateRoot('/etc/barber-staging-cloudflared');
  assert.equal(lstatSync('/etc/barber-staging-cloudflared/tunnel-token').mode & 0o077, 0);
  parts['live/tunnel-token'] = readProtected('/etc/barber-staging-cloudflared/tunnel-token');
  parts['live/cloudflared.service'] = readProtected('/etc/systemd/system/barber-staging-cloudflared.service');
  mkdirSync(lock, { mode: 0o700 });
  writeFileSync(`${lock}/journal.json`, JSON.stringify({ version: 1, createdAt: new Date().toISOString(), commit: release.commit,
    states, frontendSha256: checksum(parts['live/frontend.json']), backendSha256: checksum(parts['live/backend.json']) }), { flag: 'wx', mode: 0o600 });
  flushPath(`${lock}/journal.json`); flushPath(lock); flushPath('/var/backups/barber-staging');
  stage = 'quiesce'; stopped = true;
  docker(['stop', '--time', '15', ...states.filter(state => state.name !== `${PROJECT}-db`).map(state => state.id)], { timeout: 120000 });
  const captureAt = new Date().toISOString();
  const id = `staging-${captureAt.slice(0, 19).replaceAll('-', '').replaceAll(':', '')}Z-${randomBytes(4).toString('hex')}`;
  stage = 'capture';
  const recoveryRole = validateRecoveryRole(JSON.parse(sql(recoveryRoleQuery)));
  const counts = JSON.parse(sql("SELECT json_build_object('users',(SELECT count(*) FROM auth.users),'branches',(SELECT count(*) FROM public.branches),'objects',(SELECT count(*) FROM storage.objects),'migrations',(SELECT count(*) FROM supabase_migrations.schema_migrations));"));
  parts['database.dump'] = docker(['exec', '-u', 'postgres', `${PROJECT}-db`, 'pg_dump', '-U', 'supabase_admin', '-d', 'postgres', '--format=custom'], { encoding: null, maxBuffer: BACKUP_LIMIT, timeout: 120000 });
  parts['storage.tar'] = docker(['run', '--rm', '--name', `${PROJECT}-backup-storage`, '--network', 'none', '--read-only',
    '--cap-drop', 'ALL', '--cap-add', 'CHOWN', '--cap-add', 'FOWNER', '--cap-add', 'DAC_OVERRIDE', '--security-opt', 'no-new-privileges',
    '--memory', '256m', '--cpus', '0.5', '--pids-limit', '64', '--mount', `type=volume,src=${context.backend.volumes.storage.name},dst=/data,readonly`,
    '--entrypoint', 'tar', tarImage, '--xattrs', '--xattrs-include=user.*', '--acls', '--numeric-owner', '-C', '/data', '-cpf', '-', '.'],
  { encoding: null, maxBuffer: BACKUP_LIMIT, timeout: 60000 });
  docker(['stop', '--time', '15', states.find(state => state.name === `${PROJECT}-db`).id]);
  parts['database-config.tar'] = docker(['cp', `${PROJECT}-db:/etc/postgresql-custom/.`, '-'], { encoding: null, maxBuffer: BACKUP_LIMIT });
  const bundle = packLiveBackup(parts, { source: context.prepared.approvedSource, host: 'srv1207055', id, createdAt: captureAt,
    counts, recoveryRole, vaultProbe, scope: 'live-nine-service-state', scheduled: process.argv[2] === '--scheduled',
    ephemeralExclusions: ['Mailpit inbox', 'Realtime connections/cache', 'Functions tmpfs'], imageRecovery: 'separate-off-vps-image-inventory-required' });
  stage = 'encrypt'; scratch = mkdtempSync(join(tmpdir(), 'barber-live-capture-'));
  writeFileSync(join(scratch, 'bundle.json'), bundle, { flag: 'wx', mode: 0o600 });
  const tar = execFileSync('/usr/bin/tar', ['-C', scratch, '-cf', '-', 'bundle.json'], { maxBuffer: BACKUP_LIMIT, stdio: ['ignore', 'pipe', 'pipe'] });
  const encrypted = execFileSync('/usr/bin/age', ['-R', '/etc/barber-staging-backup/recipient.txt'], { input: tar, maxBuffer: BACKUP_LIMIT + 1048576, stdio: ['pipe', 'pipe', 'pipe'] });
  stage = 'resume'; await resumeStates(docker, states); stopped = false;
  // Recheck exact identity and origins after resumption; no publication on drift.
  liveContext();
  directory = `${exportRoot}/${id}`; mkdirSync(directory, { mode: 0o700 });
  writeFileSync(`${directory}/payload.tar.age`, encrypted, { flag: 'wx', mode: 0o600 });
  flushPath(`${directory}/payload.tar.age`);
  const manifest = { version: 1, id, environment: 'staging', sourceHost: 'srv1207055', kind: 'staging-backup', file: 'payload.tar.age',
    sha256: checksum(encrypted), bytes: encrypted.length, createdAt: captureAt };
  writeFileSync(`${directory}/capture.json`, JSON.stringify({ id, commit: release.commit, scheduled: process.argv[2] === '--scheduled',
    createdAt: captureAt, completedAt: new Date().toISOString(), version: 2, servicesResumed: true }), { flag: 'wx', mode: 0o600 });
  flushPath(`${directory}/capture.json`); flushPath(directory);
  writeFileSync(`${directory}/manifest.json`, JSON.stringify(manifest), { flag: 'wx', mode: 0o600 });
  flushPath(`${directory}/manifest.json`); flushPath(directory); flushPath(exportRoot);
  complete = true; console.log(JSON.stringify({ status: 'live-capture-verified', id, sha256: manifest.sha256, bytes: encrypted.length, offVpsVerified: false }));
} catch {
  console.error(`Live staging capture failed at ${stage}; no success claimed.`); process.exitCode = 1;
} finally {
  if (stopped && context) {
    try { await resumeStates(context.docker, context.states); stopped = false; }
    catch { console.error('Staging service recovery needs operator attention.'); process.exitCode = 1; }
  }
  if (scratch) rmSync(scratch, { recursive: true });
  if (complete && !stopped) { rmSync(`${lock}/journal.json`); rmdirSync(lock); }
  if (!complete && directory) console.error('Incomplete export retained for review.');
}
