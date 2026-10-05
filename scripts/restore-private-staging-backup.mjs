// Receives an already authenticated/decrypted backup through pinned SSH stdin.
// Never reads the owner's private age identity and never restores into live volumes.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createPublicKey, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { localDockerProbe } from './local-docker-probe.mjs';
import { APPROVED_SOURCE, INSTALL_ROOT, SERVICES } from './staging-private-model.mjs';
import { BACKUP_LIMIT, checksum, unpackPrivateBackup } from './staging-private-backup-format.mjs';
import { restoreRecoveryRoleSql, recoveryRoleQuery } from './staging-recovery-roles.mjs';
import { fullStackClient } from './staging-full-stack-client.mjs';
import { isPrivateStorageDenied } from './rehearse-staging-core-recovery.mjs';
import { writePublicContainerSource } from './write-public-container-source.mjs';

const TAR_IMAGE = 'node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e';
const project = `barber-staging-restore-${randomBytes(8).toString('hex')}`;
const label = 'cloud.malabdullah.barber.disposable-restore';
let stage = 'archive validation'; let scratch; let docker; let model; let compose; let created = false; let completed;
try {
  assert.equal(hostname(), 'srv1207055'); assert.equal(process.getuid(), 0);
  assert.equal(process.argv.length, 3);
  assert.match(process.argv[2], /^staging-\d{8}T\d{6}Z-[a-f0-9]{8}$/);
  const chunks = []; let bytes = 0;
  for await (const chunk of process.stdin) { bytes += chunk.length; assert.ok(bytes <= BACKUP_LIMIT); chunks.push(chunk); }
  const archive = Buffer.concat(chunks);
  const tarOptions = { input: archive, maxBuffer: BACKUP_LIMIT, timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'] };
  assert.equal(execFileSync('/usr/bin/tar', ['-tf', '-'], tarOptions).toString().trim(), 'bundle.json');
  assert.ok(execFileSync('/usr/bin/tar', ['-tvf', '-'], tarOptions).toString().startsWith('-'), 'Expected one regular archive member');
  const payload = execFileSync('/usr/bin/tar', ['-xOf', '-', 'bundle.json'], tarOptions);
  const { metadata, entries, model: original } = unpackPrivateBackup(payload);
  assert.equal(metadata.id, process.argv[2]);
  docker = localDockerProbe();
  const before = docker(['ps', '--format', '{{.ID}} {{.Names}} {{.Image}}']).split('\n').filter(Boolean).sort();
  assert.equal(docker(['network', 'ls', '-q', '--filter', `name=^${project}$`]), '');
  scratch = mkdtempSync(join(tmpdir(), `${project}-`));
  for (const dir of ['sql', 'gateway']) mkdirSync(join(scratch, dir), { mode: 0o700 });
  for (const [path, data] of Object.entries(entries)) {
    if (path.startsWith('sql/') || path.startsWith('gateway/')) writePublicContainerSource(join(scratch, path), data);
  }
  model = structuredClone(original);
  model.name = project;
  model.networks.default = { name: project, internal: true, labels: { [label]: project } };
  for (const [key, volume] of Object.entries(model.volumes)) {
    volume.name = `${project}-${key}`; volume.labels = { [label]: project };
    assert.equal(docker(['volume', 'ls', '-q', '--filter', `name=^${volume.name}$`]), '');
  }
  for (const [name, service] of Object.entries(model.services)) {
    service.container_name = `${project}-${name}`; service.labels = { [label]: project }; service.restart = 'no';
    for (const mount of service.volumes) if (mount.type === 'bind') mount.source = mount.source.replace(INSTALL_ROOT, scratch);
    assert.equal(docker(['ps', '-aq', '--filter', `name=^/${service.container_name}$`]), '');
  }
  compose = (args, options = {}) => docker(['compose', '--project-directory', scratch, '-p', project, '-f', '-', ...args],
    { input: JSON.stringify(model), timeout: 300000, ...options });
  const sql = (input, database = 'postgres') => docker(['exec', '-i', '-u', 'postgres', `${project}-db`,
    'psql', '-U', 'supabase_admin', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-d', database], { input }).trim();
  const assertOwned = () => {
    const [state] = JSON.parse(docker(['inspect', `${project}-db`]));
    assert.equal(state.Config.Labels[label], project);
    assert.ok(state.Mounts.filter((mount) => mount.Type === 'volume').every((mount) => Object.values(model.volumes).some((volume) => volume.name === mount.Name)));
  };
  stage = 'fresh recovery database and Vault root key'; created = true;
  compose(['create', '--no-build', '--pull', 'never', 'db']); assertOwned();
  docker(['cp', '--archive', '-', `${project}-db:/etc/postgresql-custom`], { input: entries['database-config.tar'], maxBuffer: BACKUP_LIMIT });
  compose(['up', '-d', '--wait', '--wait-timeout', '180', 'db']); assertOwned();
  assert.equal(sql('SHOW cron.launch_active_jobs;'), 'off');
  assert.equal(JSON.parse(sql(recoveryRoleQuery)), null);
  const roleSql = restoreRecoveryRoleSql(metadata.recoveryRole); if (roleSql) sql(roleSql);
  assert.deepEqual(JSON.parse(sql(recoveryRoleQuery)), metadata.recoveryRole);
  stage = 'logical import into disposable target';
  assertOwned();
  sql('DROP DATABASE postgres WITH (FORCE);', 'template1');
  docker(['exec', '-i', '-u', 'postgres', `${project}-db`, 'pg_restore', '-U', 'supabase_admin',
    '-d', 'template1', '--create', '--exit-on-error'], { input: entries['database.dump'], maxBuffer: BACKUP_LIMIT, timeout: 90000 });
  assert.equal(sql('SELECT count(*) FROM auth.users;'), String(metadata.counts.users));
  assert.equal(sql('SELECT count(*) FROM storage.objects;'), String(metadata.counts.objects));
  assert.equal(sql('SELECT count(*) FROM supabase_migrations.schema_migrations;'), '4');
  assert.equal(sql("SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='bootstrap_recovery_probe';"), metadata.vaultProbe);
  stage = 'Storage bytes and extended attributes restore';
  compose(['create', '--no-build', '--pull', 'never']);
  assert.equal(JSON.parse(docker(['volume', 'inspect', model.volumes.storage.name]))[0].Labels[label], project);
  assert.equal(JSON.parse(docker(['inspect', `${project}-storage`]))[0].State.Running, false);
  docker(['run', '--rm', '-i', '--name', `${project}-storage-restore`, '--network', 'none', '--read-only',
    '--label', `${label}=${project}`, '--platform', 'linux/amd64', '--cap-drop', 'ALL', '--cap-add', 'CHOWN',
    '--cap-add', 'FOWNER', '--cap-add', 'DAC_OVERRIDE', '--security-opt', 'no-new-privileges',
    '--memory', '256m', '--cpus', '0.5', '--pids-limit', '64', '--mount', `type=volume,src=${model.volumes.storage.name},dst=/data`,
    '--entrypoint', 'tar', TAR_IMAGE, '--xattrs', '--xattrs-include=user.*', '--acls', '--numeric-owner', '-C', '/data', '-xpf', '-'],
  { input: entries['storage.tar'], maxBuffer: BACKUP_LIMIT, timeout: 60000 });
  stage = 'all eight restored services';
  compose(['up', '-d', '--wait', '--wait-timeout', '240']);
  for (const name of SERVICES) {
    const [state] = JSON.parse(docker(['inspect', `${project}-${name}`]));
    assert.equal(state.Config.Labels[label], project); assert.equal(state.State.Running, true);
    assert.deepEqual(Object.keys(state.HostConfig.PortBindings || {}), []);
    assert.deepEqual(Object.keys(state.NetworkSettings.Networks), [project]);
  }
  assert.equal(JSON.parse(docker(['network', 'inspect', project]))[0].Internal, true);
  const env = model.services.functions.environment;
  const accounts = JSON.parse(entries['synthetic-accounts.json']);
  const integrations = JSON.parse(entries['synthetic-integration.json']);
  const settings = { anon: env.SUPABASE_ANON_KEY, key: env.SUPABASE_SERVICE_ROLE_KEY, ...integrations,
    password: accounts.find((a) => a.email === 'admin@barber.test').password,
    barberPassword: accounts.find((a) => a.email === 'barber@barber.test').password,
    otherManagerPassword: accounts.find((a) => a.email === 'manager-two@barber.test').password,
    flowPublic: createPublicKey(env.WHATSAPP_FLOW_PRIVATE_KEY).export({ type: 'spki', format: 'pem' }).toString() };
  stage = 'recovered Storage metadata and sandbox mail';
  const recovered = async (input) => {
    const ok = (value) => { if (!value) throw new Error('RECOVERED_PRIVATE_CHECK_FAILED'); };
    const headers = { Authorization: 'Bearer ' + input.key, 'Content-Type': 'application/json' };
    for (const [file, content] of [['check.txt', 'synthetic-only'], ['gateway.txt', 'synthetic-gateway-only']]) {
      const response = await fetch('http://storage:5000/object/authenticated/synthetic-probe/' + file, { headers });
      ok(response.status === 200 && (response.headers.get('content-type') || '').startsWith('text/plain') && await response.text() === content);
    }
    // Only the disposable restored fixture's gateway object is removed so the
    // unchanged full-stack test can recreate it. The live source is untouched.
    const removed = await fetch('http://storage:5000/object/synthetic-probe', { method: 'DELETE', headers, body: JSON.stringify({ prefixes: ['gateway.txt'] }) });
    ok(removed.status === 200);
    const invite = await fetch('http://auth:9999/invite', { method: 'POST', headers, body: JSON.stringify({ email: 'restored-probe@barber.test' }) });
    ok(invite.status === 200);
    const messages = await (await fetch('http://mailpit:8025/api/v1/messages')).json(); ok(messages.total === 1);
    console.log('PASS: restored Storage bytes/types and sink-only SMTP');
  };
  console.log(docker(['exec', '-i', `${project}-storage`, 'node', '--input-type=module'], { input: `await (${recovered.toString()})(${JSON.stringify({ key: settings.key })});` }));
  stage = 'restored gateway Functions and Realtime';
  const admin = sql("SELECT id FROM auth.users WHERE email='admin@barber.test';"); assert.match(admin, /^[a-f0-9-]{36}$/);
  sql(`CREATE POLICY full_stack_probe_read ON realtime.messages FOR SELECT TO authenticated USING ((select auth.uid())='${admin}'::uuid AND realtime.topic()='probe-allowed');
    CREATE POLICY full_stack_probe_write ON realtime.messages FOR INSERT TO authenticated WITH CHECK ((select auth.uid())='${admin}'::uuid AND realtime.topic()='probe-allowed');`);
  console.log(docker(['exec', '-i', `${project}-storage`, 'node', '--input-type=module'],
    { input: `await (${fullStackClient.toString()})(${JSON.stringify(settings)}, (${isPrivateStorageDenied.toString()}));`, timeout: 180000 }));
  const after = docker(['ps', '--format', '{{.ID}} {{.Names}} {{.Image}}']).split('\n')
    .filter((line) => line && !line.split(' ')[1].startsWith(`${project}-`)).sort();
  assert.deepEqual(after, before, 'Existing services changed during restore');
  completed = { backupId: metadata.id, approvedSource: APPROVED_SOURCE, verifiedAt: new Date().toISOString(),
    scope: 'eight-service-new-volume-restore', project, bundleSha256: checksum(payload), restoredServices: SERVICES,
    checks: ['Auth', 'RLS', 'Vault decryption', 'Storage bytes and xattrs', 'SMTP sink', 'gateway boundaries', 'Functions signatures and Flow', 'Realtime events and tenant denial'],
    originalServicesUnchanged: true, liveVolumesOverwritten: false, releaseAccepted: false };
} catch {
  console.error(`Disposable private restore failed at: ${stage}. No restore success claimed.`);
  process.exitCode = 1;
} finally {
  let cleaned = !created;
  if (created && docker && model && compose) {
    try {
      for (const service of Object.values(model.services)) {
        const ids = docker(['ps', '-aq', '--filter', `name=^/${service.container_name}$`]);
        if (ids) assert.equal(JSON.parse(docker(['inspect', ids]))[0].Config.Labels[label], project);
      }
      for (const volume of Object.values(model.volumes)) {
        const ids = docker(['volume', 'ls', '-q', '--filter', `name=^${volume.name}$`]);
        if (ids) assert.equal(JSON.parse(docker(['volume', 'inspect', volume.name]))[0].Labels[label], project);
      }
      const network = docker(['network', 'ls', '-q', '--filter', `name=^${project}$`]);
      if (network) assert.equal(JSON.parse(docker(['network', 'inspect', project]))[0].Labels[label], project);
      compose(['down', '--volumes', '--timeout', '10']); cleaned = true;
      console.log('Removed only this labelled disposable restore stack and its synthetic volumes.');
    } catch { console.error(`Scoped restore cleanup requires attention: ${project}`); process.exitCode = 1; }
  }
  if (scratch && cleaned) rmSync(scratch, { recursive: true });
  if (completed && cleaned) {
    writeFileSync(`${INSTALL_ROOT}/restore-${completed.backupId}.json`, JSON.stringify({ ...completed, temporaryResourcesCleaned: true }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ backupId: completed.backupId, status: 'eight-service-restore-verified', temporaryResourcesCleaned: true, releaseAccepted: false }));
  }
}
