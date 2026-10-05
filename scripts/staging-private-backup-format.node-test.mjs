import assert from 'node:assert/strict';
import { test } from 'node:test';
import { APPROVED_SOURCE, PROJECT, OWNER_LABEL, SERVICES, IMAGES } from './staging-private-model.mjs';
import { BACKUP_LIMIT, checksum, packPrivateBackup, unpackPrivateBackup, validateBackupFile } from './staging-private-backup-format.mjs';

function fixture() {
  const labels = { [OWNER_LABEL]: APPROVED_SOURCE };
  const model = { name: PROJECT, services: {}, networks: { default: { name: PROJECT, internal: true, labels } }, volumes: {} };
  for (const key of ['data', 'config', 'storage']) model.volumes[key] = { name: `${PROJECT}-${key}`, labels };
  for (const name of SERVICES) model.services[name] = {
    image: IMAGES[name], container_name: `${PROJECT}-${name}`, platform: 'linux/amd64', pull_policy: 'never',
    ports: [], networks: { default: {} }, labels, mem_limit: 1073741824, cpus: 1, pids_limit: 256, volumes: [], environment: {},
  };
  for (const name of ['realtime', 'functions', 'api-gw', 'mailpit']) Object.assign(model.services[name], {
    user: name === 'realtime' ? '65534:65534' : '10001:10001', read_only: true, cap_drop: ['ALL'], security_opt: ['no-new-privileges:true'],
  });
  model.services.realtime.environment.ERL_AFLAGS = '-proto_dist inet_tcp';
  model.services.functions.environment = { WHATSAPP_ACCESS_TOKEN: '', WHATSAPP_PHONE_NUMBER_ID: '',
    OUTBOUND_RECIPIENT_ALLOWLIST: '', OPENAI_API_KEY: '', AI_OUTBOUND_ENABLED: 'false' };
  model.services.auth.environment = { GOTRUE_SMTP_HOST: 'mailpit', GOTRUE_SMTP_PASS: '' };
  model.services.db.command = ['postgres', '-c', 'cron.launch_active_jobs=off'];
  const parts = Object.fromEntries(['database.dump', 'storage.tar', 'database-config.tar', 'synthetic-accounts.json',
    'synthetic-integration.json', 'seed.private.sql', 'initialized.json', 'functional-verified.json', 'security-tests.sql']
    .map((path) => [path, Buffer.from('synthetic fixture')]));
  parts['compose.private.json'] = Buffer.from(JSON.stringify(model));
  parts['prepared.json'] = Buffer.from(JSON.stringify({ approvedSource: APPROVED_SOURCE,
    composeSha256: checksum(parts['compose.private.json']), seedSha256: checksum(parts['seed.private.sql']), publicFiles: {}, migrations: {} }));
  const metadata = { source: APPROVED_SOURCE, host: 'srv1207055', id: 'staging-20261005T000000Z-abcdef01',
    vaultProbe: 'a'.repeat(48), recoveryRole: null };
  return { parts, metadata };
}

test('bounded backup round trip binds database, Storage, Vault config and exact private model', () => {
  const { parts, metadata } = fixture();
  const unpacked = unpackPrivateBackup(packPrivateBackup(parts, metadata));
  assert.deepEqual(unpacked.entries, parts); assert.deepEqual(unpacked.metadata, metadata);
});
for (const name of ['../escape', '/etc/passwd', 'sql/../../secret', 'migrations/not-a-migration.sql', 'runtime.env', 'gateway/evil.sh']) {
  test(`backup rejects unexpected path ${name}`, () => assert.throws(() => validateBackupFile(name)));
}
for (const [label, mutate] of Object.entries({
  'wrong source': (b) => { b.metadata.source = '0'.repeat(40); },
  'production host': (b) => { b.metadata.host = 'srv1073968'; },
  'unexpected file': (b) => { b.entries['../../etc/shadow'] = b.entries['database.dump']; },
  'tampered data': (b) => { b.entries['database.dump'].data = Buffer.from('changed').toString('base64'); },
  'missing Vault key archive': (b) => { delete b.entries['database-config.tar']; },
  'missing database': (b) => { delete b.entries['database.dump']; },
  'unknown top field': (b) => { b.command = 'bad'; },
})) test(`backup refuses ${label}`, () => {
  const { parts, metadata } = fixture(); const bundle = JSON.parse(packPrivateBackup(parts, metadata));
  mutate(bundle); assert.throws(() => unpackPrivateBackup(Buffer.from(JSON.stringify(bundle))));
});
test('backup refuses an oversized payload before parsing', () => assert.throws(() => unpackPrivateBackup(Buffer.alloc(BACKUP_LIMIT + 1))));
