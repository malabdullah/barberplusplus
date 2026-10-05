import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveRelease } from './check-supabase-pin.mjs';
import { MAILPIT_ENV, MAILPIT_IMAGE, POSTGRES_COMMAND, POSTGRES_IMAGE, validateCompose } from './check-vps-compose.mjs';

test('bootstrap SQL permissions survive private umask without relaxing secrets or accepting symlinks', () => {
  const root = mkdtempSync(join(tmpdir(), 'barber-sql-permission-test-'));
  try {
    chmodSync(root, 0o700);
    const db = join(root, 'volumes/db');
    mkdirSync(db, { recursive: true, mode: 0o700 });
    const names = ['realtime', '_supabase', 'logs', 'webhooks', 'pooler', 'jwt', 'roles'];
    for (const name of names) writeFileSync(join(db, `${name}.sql`), '-- public source fixture\n', { mode: 0o600 });
    const secret = join(root, '.env');
    writeFileSync(secret, 'SYNTHETIC=fixture\n', { mode: 0o600 });
    const source = readFileSync(new URL('./bootstrap-staging-supabase.sh', import.meta.url), 'utf8');
    const loop = source.match(/for sql_name in realtime _supabase logs webhooks pooler jwt roles; do\n[\s\S]*?\ndone/);
    assert.ok(loop, 'Expected bounded SQL permission preparation');
    const execute = () => execFileSync('sh', ['-c', `set -eu; umask 077; target="$1"\n${loop[0]}`, 'permission-test', root], { stdio: 'pipe' });
    execute();
    for (const name of names) assert.equal(statSync(join(db, `${name}.sql`)).mode & 0o777, 0o644);
    assert.equal(statSync(root).mode & 0o777, 0o700);
    assert.equal(statSync(secret).mode & 0o777, 0o600);
    unlinkSync(join(db, 'roles.sql'));
    symlinkSync(secret, join(db, 'roles.sql'));
    assert.throws(execute);
    assert.equal(statSync(secret).mode & 0o777, 0o600);
    unlinkSync(join(db, 'roles.sql'));
    assert.throws(execute);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('annotated releases resolve to source commits, not tag objects', () => {
  const tag = 'a'.repeat(40);
  const commit = 'b'.repeat(40);
  assert.equal(resolveRelease(`${tag}\trefs/tags/self-hosted/v0.8.0\n${commit}\trefs/tags/self-hosted/v0.8.0^{}`, 'self-hosted/v0.8.0'), commit);
  assert.equal(resolveRelease(`${commit}\trefs/tags/self-hosted/v0.8.0`, 'self-hosted/v0.8.0'), commit);
  assert.throws(() => resolveRelease('', 'self-hosted/v0.8.0'));
});

function fixture() {
  const services = {};
  for (const name of ['api-gw', 'auth', 'rest', 'realtime', 'storage', 'functions', 'db']) {
    services[name] = {
      container_name: name === 'realtime' ? 'realtime-dev.barber-staging-realtime'
        : `barber-staging-${name}`,
      image: 'fixture/service:1.0.0', networks: { default: null }, environment: {},
    };
  }
  services['api-gw'].ports = [{ host_ip: '127.0.0.1', published: '18000', target: 8000, protocol: 'tcp' }];
  services['api-gw'].volumes = [['staging-cds.yaml', 'cds.yaml'], ['staging-lds.template.yaml', 'lds.template.yaml']].map(([file, target]) => ({
    type: 'bind', source: `/opt/barber-staging/supabase/volumes/api/envoy/${file}`, target: `/etc/envoy/${target}`, read_only: true,
  }));
  services.storage.environment = { ENABLE_IMAGE_TRANSFORMATION: 'false', IMGPROXY_URL: '' };
  services.storage.depends_on = { db: { condition: 'service_healthy' }, rest: { condition: 'service_started' } };
  services.db.ports = [{ host_ip: '127.0.0.1', published: '15432', target: 5432, protocol: 'tcp' }];
  services.db.image = POSTGRES_IMAGE;
  services.db.command = [...POSTGRES_COMMAND];
  services.auth.networks['mail-sink'] = null;
  services.mailpit = {
    container_name: 'barber-staging-mailpit', image: MAILPIT_IMAGE,
    networks: { 'mail-sink': null }, user: '10001:10001', read_only: true,
    cap_drop: ['ALL'], security_opt: ['no-new-privileges:true'],
    tmpfs: ['/tmp:rw,noexec,nosuid,size=128m,uid=10001,gid=10001,mode=0700'],
    mem_limit: 268435456, cpus: 0.5, pids_limit: 100,
    ports: [],
    environment: { ...MAILPIT_ENV },
  };
  services.auth.environment = {
    GOTRUE_SITE_URL: 'https://staging-barber.malabdullah.cloud',
    API_EXTERNAL_URL: 'https://supabase-staging.malabdullah.cloud/auth/v1',
    GOTRUE_DISABLE_SIGNUP: 'true', GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED: 'false',
    GOTRUE_EXTERNAL_PHONE_ENABLED: 'false',
    GOTRUE_TRACING_ENABLED: 'false', GOTRUE_METRICS_ENABLED: 'false',
    GOTRUE_SMTP_HOST: 'mailpit', GOTRUE_SMTP_PORT: '1025', GOTRUE_SMTP_ADMIN_EMAIL: 'no-reply@barber.test',
    GOTRUE_SMTP_USER: '', GOTRUE_SMTP_PASS: '',
  };
  services.functions.environment = {
    APP_ENV: 'staging', APP_URL: 'https://staging-barber.malabdullah.cloud',
    VERIFY_JWT: 'true',
    OUTBOUND_RECIPIENT_ALLOWLIST: '', WHATSAPP_ACCESS_TOKEN: '', OPENAI_API_KEY: '', AI_OUTBOUND_ENABLED: 'false',
  };
  services.functions.volumes = [{ type: 'bind', source: '/opt/barber-staging/supabase/volumes/functions', target: '/home/deno/functions', read_only: true }];
  return { name: 'barber-staging', services,
    networks: { default: { name: 'barber-staging-internal' }, 'mail-sink': { name: 'barber-staging-mail-sink', internal: true } },
    volumes: { 'db-config': { name: 'barber-staging-db-config' }, 'deno-cache': { name: 'barber-staging-deno-cache' } } };
}

test('accepts the isolated initial topology', () => validateCompose(fixture()));
const unsafeChanges = {
  'missing cron quarantine': (c) => { delete c.services.db.command; },
  'cron execution enabled': (c) => { c.services.db.command[c.services.db.command.length - 1] = 'cron.launch_active_jobs=on'; },
  'old database image': (c) => { c.services.db.image = 'supabase/postgres:17.6.1.136'; },
  'mutable database patch tag': (c) => { c.services.db.image = 'supabase/postgres:17.11.0.002'; },
  'different database digest': (c) => { c.services.db.image = POSTGRES_IMAGE.replace(/sha256:.*/, 'sha256:' + 'a'.repeat(64)); },
  'different database engine': (c) => { c.services.db.image = POSTGRES_IMAGE.replace('17.11.0.002@', '17.11.0.002-orioledb@'); },
  'wildcard API binding': (c) => { c.services['api-gw'].ports[0].host_ip = '0.0.0.0'; },
  'IPv6 public binding': (c) => { c.services.db.ports[0].host_ip = '::'; },
  'pooler reintroduced': (c) => { c.services.supavisor = { image: 'fixture/pooler:1', ports: [{ published: '6543' }] }; },
  'dashboard reintroduced': (c) => { c.services.studio = c.services.rest; },
  'management API reintroduced': (c) => { c.services.meta = c.services.rest; },
  'image proxy reintroduced': (c) => { c.services.imgproxy = c.services.rest; },
  'image transformations enabled': (c) => { c.services.storage.environment.ENABLE_IMAGE_TRANSFORMATION = 'true'; },
  'image proxy configured': (c) => { c.services.storage.environment.IMGPROXY_URL = 'http://imgproxy:5001'; },
  'optional gateway dependency': (c) => { c.services['api-gw'].depends_on = { studio: {} }; },
  'optional storage dependency': (c) => { c.services.storage.depends_on.imgproxy = {}; },
  'foreign service dependency': (c) => { c.services.auth.depends_on = { production: {} }; },
  'upstream gateway template': (c) => { c.services['api-gw'].volumes[1].source = '/opt/barber-staging/supabase/volumes/api/envoy/lds.template.yaml'; },
  'writable gateway template': (c) => { c.services['api-gw'].volumes[1].read_only = false; },
  'wrong container': (c) => { c.services.db.container_name = 'supabase-db'; },
  'production data mount': (c) => { c.services.db.volumes = [{ type: 'bind', source: '/etc/dokploy/production/data' }]; },
  'Docker socket mount': (c) => { c.services.functions.volumes = [{ type: 'bind', source: '/var/run/docker.sock' }]; },
  'parent traversal': (c) => { c.services.db.volumes = [{ type: 'bind', source: '/opt/barber-staging/supabase/volumes/../../production' }]; },
  'external volume': (c) => { c.volumes['db-config'].external = true; },
  'shared network': (c) => { c.networks.default.external = true; },
  'extra network': (c) => { c.services.auth.networks.production = null; },
  'host network': (c) => { c.services.auth.network_mode = 'host'; },
  'privileged container': (c) => { c.services.db.privileged = true; },
  'mutable latest image': (c) => { c.services.auth.image = 'supabase/gotrue:latest'; },
  'wrong Auth origin': (c) => { c.services.auth.environment.GOTRUE_SITE_URL = 'https://production.invalid'; },
  'Auth tracing enabled': (c) => { c.services.auth.environment.GOTRUE_TRACING_ENABLED = 'true'; },
  'Auth metrics enabled': (c) => { c.services.auth.environment.GOTRUE_METRICS_ENABLED = 'true'; },
  'Auth tracing gate absent': (c) => { delete c.services.auth.environment.GOTRUE_TRACING_ENABLED; },
  'Auth telemetry destination': (c) => { c.services.auth.environment.OTEL_EXPORTER_OTLP_ENDPOINT = 'https://collector.invalid'; },
  'anonymous signup': (c) => { c.services.auth.environment.GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED = 'true'; },
  'external SMTP provider': (c) => { c.services.auth.environment.GOTRUE_SMTP_HOST = 'smtp.production.invalid'; },
  'SMTP provider credential': (c) => { c.services.auth.environment.GOTRUE_SMTP_PASS = 'synthetic-secret'; },
  'public mail inbox': (c) => { c.services.mailpit.ports.push({ host_ip: '0.0.0.0', published: '18025', target: 8025 }); },
  'published SMTP': (c) => { c.services.mailpit.ports.push({ published: '1025' }); },
  'mail sink default network': (c) => { c.services.mailpit.networks.default = null; },
  'mail sink external routing': (c) => { c.networks['mail-sink'].internal = false; },
  'mail sink shared network': (c) => { c.networks['mail-sink'].external = true; },
  'mail sink root user': (c) => { c.services.mailpit.user = '0:0'; },
  'mail sink mutable image': (c) => { c.services.mailpit.image = 'axllent/mailpit:v1.31.3'; },
  'mail sink all recipients': (c) => { c.services.mailpit.environment.MP_SMTP_ALLOWED_RECIPIENTS = '.*'; },
  'mail sink relay': (c) => { c.services.mailpit.environment.MP_SMTP_RELAY_HOST = 'smtp.example.invalid'; },
  'mail sink forwarding': (c) => { c.services.mailpit.environment.MP_SMTP_FORWARD_CONFIG = '/tmp/relay'; },
  'mail sink webhook': (c) => { c.services.mailpit.environment.MP_WEBHOOK_URL = 'https://example.invalid'; },
  'mail sink config override': (c) => { c.services.mailpit.command = ['--smtp-relay-all']; },
  'mail sink mounted config': (c) => { c.services.mailpit.volumes = [{ type: 'volume', source: 'db-config' }]; },
  'mail sink alternate entrypoint': (c) => { c.services.mailpit.entrypoint = ['sh']; },
  'live integration credential': (c) => { c.services.functions.environment.OPENAI_API_KEY = 'not-a-real-key'; },
  'AI outbound enabled': (c) => { c.services.functions.environment.AI_OUTBOUND_ENABLED = 'true'; },
  'legacy AI credential': (c) => { c.services.functions.environment.ANTHROPIC_API_KEY = 'not-a-real-key'; },
  'global JWT bypass': (c) => { c.services.functions.environment.VERIFY_JWT = 'false'; },
  'writable function source': (c) => { c.services.functions.volumes[0].read_only = false; },
  'unknown service': (c) => { c.services.unknown = c.services.db; },
};
for (const [name, change] of Object.entries(unsafeChanges)) {
  test(`rejects ${name}`, () => {
    const config = fixture(); change(config);
    assert.throws(() => validateCompose(config));
  });
}

function compiledFixture() {
  const config = fixture();
  delete config.volumes['deno-cache'];
  Object.assign(config.services.functions, {
    image: 'ghcr.io/malabdullah/barberplusplus-functions@sha256:' + 'a'.repeat(64),
    volumes: [], command: ['start', '--main-service', '/home/deno/bundles/main.eszip'],
    user: '10001:10001', read_only: true, cap_drop: ['ALL'], security_opt: ['no-new-privileges:true'],
    tmpfs: ['/tmp:rw,noexec,nosuid,size=128m,uid=10001,gid=10001,mode=0700'],
    mem_limit: 805306368, cpus: 1, pids_limit: 256,
  });
  return config;
}
test('compiled-only gate rejects the old source-mounted configuration', () => {
  assert.throws(() => validateCompose(fixture(), { requireCompiledFunctions: true }));
  validateCompose(compiledFixture(), { requireCompiledFunctions: true });
});
for (const [name, mutate] of Object.entries({
  tag: (s) => { s.image = 'ghcr.io/malabdullah/barberplusplus-functions:latest'; },
  registry: (s) => { s.image = 'outside.invalid/image@sha256:' + 'a'.repeat(64); },
  root: (s) => { s.user = '0:0'; },
  writable: (s) => { s.read_only = false; },
  sourceMount: (s) => { s.volumes = fixture().services.functions.volumes; },
  command: (s) => { s.command = ['start', '--main-service', '/home/deno/functions/main']; },
  entrypoint: (s) => { s.entrypoint = ['sh']; },
  privileges: (s) => { s.security_opt = []; },
})) {
  test(`compiled-only gate rejects ${name}`, () => {
    const config = compiledFixture(); mutate(config.services.functions);
    assert.throws(() => validateCompose(config, { requireCompiledFunctions: true }));
  });
}
