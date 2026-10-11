import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { APPROVED_SOURCE, PROJECT, OWNER_LABEL, SERVICES, IMAGES, privateVariables } from './staging-private-model.mjs';
import { prepareManualFirstRelease, manualFirstRelease as release } from './staging-manual-first-release.mjs';
import { checksum } from './staging-private-backup-format.mjs';
import { LIVE_ROUTES } from './staging-live-backup-format.mjs';
import { packTestCheckpoint, unpackTestCheckpoint } from './test-checkpoint-format.mjs';
import { readTestOrHistoricalCheckpoint } from './read-test-checkpoint.mjs';
import { BOOKING_REMINDER_MIGRATION, bookingReminderRecoveryRole } from './booking-reminder-recovery-role.mjs';

function fixture() {
  const labels = { [OWNER_LABEL]: APPROVED_SOURCE };
  const original = { name: PROJECT, services: {}, networks: { default: { name: PROJECT, internal: true, labels } }, volumes: {} };
  for (const key of ['data', 'config', 'storage']) original.volumes[key] = { name: `${PROJECT}-${key}`, labels };
  for (const name of SERVICES) original.services[name] = { image: IMAGES[name], container_name: `${PROJECT}-${name}`, platform: 'linux/amd64',
    pull_policy: 'never', ports: [], networks: { default: {} }, labels, mem_limit: 1073741824, cpus: 1, pids_limit: 256, volumes: [], environment: {} };
  for (const name of ['realtime', 'functions', 'api-gw', 'mailpit']) Object.assign(original.services[name], { user: name === 'realtime' ? '65534:65534' : '10001:10001', read_only: true, cap_drop: ['ALL'], security_opt: ['no-new-privileges:true'] });
  const { variables } = privateVariables({}); original.services.realtime.environment.ERL_AFLAGS = '-proto_dist inet_tcp';
  original.services.functions.environment = { APP_ENV: 'staging', APP_URL: release.appUrl, SUPABASE_URL: 'http://api-gw:8000',
    JWT_SECRET: variables.JWT_SECRET, SUPABASE_ANON_KEY: variables.ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: variables.SERVICE_ROLE_KEY,
    WHATSAPP_ACCESS_TOKEN: '', WHATSAPP_PHONE_NUMBER_ID: '', OUTBOUND_RECIPIENT_ALLOWLIST: '', OPENAI_API_KEY: '', AI_OUTBOUND_ENABLED: 'false' };
  original.services['api-gw'].environment.ANON_KEY = variables.ANON_KEY;
  original.services.auth.environment = { GOTRUE_SMTP_HOST: 'mailpit', GOTRUE_SMTP_PASS: '', API_EXTERNAL_URL: `${release.apiUrl}/auth/v1`, GOTRUE_SITE_URL: release.appUrl };
  original.services.db.command = ['postgres', '-c', 'cron.launch_active_jobs=off'];
  const prepared = prepareManualFirstRelease(original, { runtime: readFileSync(new URL('../docker/runtime-config.js.template', import.meta.url), 'utf8'), nginx: readFileSync(new URL('../docker/nginx.conf.template', import.meta.url), 'utf8') });
  const frontend = prepared.frontend; prepared.backend.services['api-gw'].ports = []; frontend.services.frontend.ports = [];
  for (const mount of frontend.services.frontend.volumes) mount.source = mount.source.replace(/(runtime-config\.js|nginx\.conf)$/, file => file === 'runtime-config.js' ? 'runtime-config.same-origin.js' : 'nginx.same-origin.conf');
  const commit = 'a'.repeat(40); frontend.services.frontend.image = `ghcr.io/malabdullah/barberplusplus@sha256:${'b'.repeat(64)}`;
  const parts = Object.fromEntries(['database.dump', 'storage.tar', 'database-config.tar', 'synthetic-accounts.json', 'synthetic-integration.json', 'seed.private.sql', 'initialized.json', 'functional-verified.json', 'security-tests.sql'].map(name => [name, Buffer.from('fixture')]));
  parts['compose.private.json'] = Buffer.from(JSON.stringify(original));
  parts['prepared.json'] = Buffer.from(JSON.stringify({ approvedSource: APPROVED_SOURCE, composeSha256: checksum(parts['compose.private.json']), seedSha256: checksum(parts['seed.private.sql']), publicFiles: {}, migrations: {} }));
  parts['migrations/20260901000000_baseline.sql'] = Buffer.from('SELECT 1;');
  parts['live/backend.json'] = Buffer.from(JSON.stringify(prepared.backend)); parts['live/frontend.json'] = Buffer.from(JSON.stringify(frontend));
  parts['live/runtime-config.js'] = Buffer.from(`window.__BARBER_CONFIG__ = Object.freeze({environment: 'staging', appUrl: '${release.appUrl}', supabaseUrl: '${release.appUrl}', supabasePublishableKey: '${variables.ANON_KEY}', release: '${commit}'});`);
  parts['live/nginx.conf'] = Buffer.from('reviewed fixture nginx'); parts['live/routes.json'] = Buffer.from(JSON.stringify(LIVE_ROUTES));
  parts['live/cloudflared.service'] = readFileSync(new URL('../ops/staging-vps/barber-staging-cloudflared.service', import.meta.url));
  parts['live/tunnel-token'] = Buffer.from(Buffer.from(JSON.stringify({ t: LIVE_ROUTES.tunnelId, a: '09c18affdb74c9a3721f79f6566df48a', s: 'fixture-not-a-credential-00000000' })).toString('base64'));
  const candidate = { schema: 'barber-test-candidate/v1', host: 'srv1207055', environment: 'staging', commit,
    images: { ...Object.fromEntries(Object.entries(prepared.backend.services).map(([name, s]) => [name, s.image])), frontend: frontend.services.frontend.image },
    migrations: [{ file: '20260901000000_baseline.sql', sha256: checksum(parts['migrations/20260901000000_baseline.sql']) }],
    configuration: Object.fromEntries([['bootstrap', 'compose.private.json'], ['backend', 'live/backend.json'], ['frontend', 'live/frontend.json'], ['runtime', 'live/runtime-config.js'], ['nginx', 'live/nginx.conf']].map(([k, path]) => [k, checksum(parts[path])])) };
  return { parts, candidate, metadata: { source: APPROVED_SOURCE, host: 'srv1207055', id: 'staging-20261011T080000Z-12345678', vaultProbe: 'c'.repeat(48), recoveryRole: null } };
}
test('v3 captures a new frontend release without changing historical release constants', () => {
  const input = fixture(); const bytes = packTestCheckpoint(input.parts, input.metadata, input.candidate);
  assert.equal(readTestOrHistoricalCheckpoint(bytes).version, 3); assert.equal(unpackTestCheckpoint(bytes).metadata.candidate.commit, input.candidate.commit);
  assert.equal(release.commit, '6217cb33bd9aaf32aa0fa924278f314988449f12');
});
test('v3 rejects corruption, migration mismatch, a production candidate and unexpected files', () => {
  const input = fixture(); const bundle = JSON.parse(packTestCheckpoint(input.parts, input.metadata, input.candidate));
  for (const mutate of [b => { b.entries['database.dump'].data = Buffer.from('corrupt').toString('base64'); },
    b => { b.metadata.candidate.migrations[0].sha256 = '0'.repeat(64); }, b => { b.metadata.candidate.host = 'srv1073968'; },
    b => { b.entries['../host-secret'] = b.entries['database.dump']; }]) {
    const bad = structuredClone(bundle); mutate(bad); assert.throws(() => readTestOrHistoricalCheckpoint(Buffer.from(JSON.stringify(bad))));
  }
});
test('v3 does not reinterpret a historical kind or accept oversized input', () => {
  const input = fixture(); const bundle = JSON.parse(packTestCheckpoint(input.parts, input.metadata, input.candidate)); bundle.kind = 'barber-staging-live-backup/v2';
  assert.throws(() => readTestOrHistoricalCheckpoint(Buffer.from(JSON.stringify(bundle))));
  assert.throws(() => readTestOrHistoricalCheckpoint(Buffer.alloc(64 * 1024 * 1024 + 1)));
});
test('v3 binds the writer role to its exact migration and rejects omission or escalation', () => {
  const input = fixture();
  const path = 'migrations/' + BOOKING_REMINDER_MIGRATION.file;
  input.parts[path] = readFileSync(new URL('../supabase/' + path, import.meta.url));
  input.candidate.migrations.push(BOOKING_REMINDER_MIGRATION);
  input.metadata.bookingReminderRole = structuredClone(bookingReminderRecoveryRole);
  const bundle = JSON.parse(packTestCheckpoint(input.parts, input.metadata, input.candidate));
  assert.deepEqual(unpackTestCheckpoint(Buffer.from(JSON.stringify(bundle))).metadata.bookingReminderRole, bookingReminderRecoveryRole);
  for (const mutate of [b => { delete b.metadata.bookingReminderRole; }, b => { b.metadata.bookingReminderRole.login = true; },
    b => { b.metadata.bookingReminderRole.memberships[0].member = 'authenticated'; }]) {
    const bad = structuredClone(bundle); mutate(bad); assert.throws(() => unpackTestCheckpoint(Buffer.from(JSON.stringify(bad))));
  }
});
