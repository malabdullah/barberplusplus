import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { APPROVED_SOURCE, PROJECT, OWNER_LABEL, SERVICES, IMAGES, privateVariables } from './staging-private-model.mjs';
import { validateLiveModels, validateRoutes, LIVE_ROUTES, unpackStagingBackup } from './staging-live-backup-format.mjs';
import { manualFirstRelease as release, prepareManualFirstRelease } from './staging-manual-first-release.mjs';
import { checksum, packPrivateBackup, BACKUP_LIMIT } from './staging-private-backup-format.mjs';

function fixture() {
  const labels = { [OWNER_LABEL]: APPROVED_SOURCE };
  const original = { name: PROJECT, services: {}, networks: { default: { name: PROJECT, internal: true, labels } }, volumes: {} };
  for (const key of ['data', 'config', 'storage']) original.volumes[key] = { name: `${PROJECT}-${key}`, labels };
  for (const name of SERVICES) original.services[name] = { image: IMAGES[name], container_name: `${PROJECT}-${name}`,
    platform: 'linux/amd64', pull_policy: 'never', ports: [], networks: { default: {} }, labels,
    mem_limit: 1073741824, cpus: 1, pids_limit: 256, volumes: [], environment: {} };
  for (const name of ['realtime', 'functions', 'api-gw', 'mailpit']) Object.assign(original.services[name], {
    user: name === 'realtime' ? '65534:65534' : '10001:10001', read_only: true, cap_drop: ['ALL'], security_opt: ['no-new-privileges:true'] });
  original.services.realtime.environment.ERL_AFLAGS = '-proto_dist inet_tcp';
  const { variables } = privateVariables({});
  original.services.functions.environment = { WHATSAPP_ACCESS_TOKEN: '', WHATSAPP_PHONE_NUMBER_ID: '', OUTBOUND_RECIPIENT_ALLOWLIST: '',
    OPENAI_API_KEY: '', AI_OUTBOUND_ENABLED: 'false', APP_ENV: 'staging', APP_URL: release.appUrl, SUPABASE_URL: 'http://api-gw:8000',
    JWT_SECRET: variables.JWT_SECRET, SUPABASE_ANON_KEY: variables.ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: variables.SERVICE_ROLE_KEY };
  original.services['api-gw'].environment.ANON_KEY = variables.ANON_KEY;
  original.services.auth.environment = { GOTRUE_SMTP_HOST: 'mailpit', GOTRUE_SMTP_PASS: '',
    API_EXTERNAL_URL: `${release.apiUrl}/auth/v1`, GOTRUE_SITE_URL: release.appUrl };
  original.services.db.command = ['postgres', '-c', 'cron.launch_active_jobs=off'];
  const candidate = prepareManualFirstRelease(original, {
    runtime: readFileSync(new URL('../docker/runtime-config.js.template', import.meta.url), 'utf8'),
    nginx: readFileSync(new URL('../docker/nginx.conf.template', import.meta.url), 'utf8') });
  candidate.backend.services['api-gw'].ports = []; candidate.frontend.services.frontend.ports = [];
  for (const mount of candidate.frontend.services.frontend.volumes) mount.source = mount.source.replace(/(runtime-config\.js|nginx\.conf)$/, file => file === 'runtime-config.js' ? 'runtime-config.same-origin.js' : 'nginx.same-origin.conf');
  return { original, backend: candidate.backend, frontend: candidate.frontend };
}
test('live validator accepts exact private release derived from independently tested preparation', () => {
  const value = fixture(); assert.equal(validateLiveModels(value.original, value.backend, value.frontend), true);
  validateRoutes(LIVE_ROUTES);
});
for (const [name, change] of Object.entries({
  'different Functions image': value => { value.backend.services.functions.image = 'supabase/edge-runtime:latest'; },
  'published API port': value => { value.backend.services['api-gw'].ports = ['8000:8000']; },
  'shared data volume': value => { value.backend.volumes.data.name = 'production'; },
  'frontend privileged': value => { value.frontend.services.frontend.privileged = true; },
  'frontend external network': value => { value.frontend.networks.default.internal = false; },
  'frontend credential mount': value => { value.frontend.services.frontend.volumes[0].source = '/etc/secret'; },
})) test(`live backup refuses ${name}`, () => {
  const value = fixture(); change(value); assert.throws(() => validateLiveModels(value.original, value.backend, value.frontend));
});
test('version 1 remains readable without reinterpretation', () => {
  const { original } = fixture();
  const parts = Object.fromEntries(['database.dump', 'storage.tar', 'database-config.tar', 'synthetic-accounts.json',
    'synthetic-integration.json', 'seed.private.sql', 'initialized.json', 'functional-verified.json', 'security-tests.sql'].map(name => [name, Buffer.from('fixture')]));
  parts['compose.private.json'] = Buffer.from(JSON.stringify(original));
  parts['prepared.json'] = Buffer.from(JSON.stringify({ approvedSource: APPROVED_SOURCE, composeSha256: checksum(parts['compose.private.json']),
    seedSha256: checksum(parts['seed.private.sql']), publicFiles: {}, migrations: {} }));
  const bytes = packPrivateBackup(parts, { source: APPROVED_SOURCE, host: 'srv1207055', id: 'staging-20261010T000000Z-abcdef01', vaultProbe: 'a'.repeat(48), recoveryRole: null });
  assert.equal(unpackStagingBackup(bytes).version, 1);
  const bad = JSON.parse(bytes); bad.kind = 'barber-staging-live-backup/v2';
  assert.throws(() => unpackStagingBackup(Buffer.from(JSON.stringify(bad))));
});
test('live reader rejects oversize input before parsing and public-path expansion', () => {
  assert.throws(() => unpackStagingBackup(Buffer.alloc(BACKUP_LIMIT + 1)));
  assert.throws(() => validateRoutes({ ...LIVE_ROUTES, publicPaths: ['/functions/v1/*'] }));
});
