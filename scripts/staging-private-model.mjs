import assert from 'node:assert/strict';
import { createHmac, generateKeyPairSync, randomBytes } from 'node:crypto';
import { coreCandidateImages } from './staging-core-candidates.mjs';
import { fullStackCandidateImages } from './staging-full-stack-probe.mjs';
import { validateCompose } from './check-vps-compose.mjs';

export const APPROVED_SOURCE = 'c24f8ecadbe49d353965a0e9b457ebcd3cfca287';
export const INSTALL_ROOT = '/opt/barber-staging/supabase';
export const PROJECT = 'barber-staging-private';
export const OWNER_LABEL = 'cloud.malabdullah.barber.private-bootstrap';
export const SERVICES = Object.freeze(['db', 'auth', 'rest', 'storage', 'mailpit', 'realtime', 'functions', 'api-gw']);
export const IMAGES = Object.freeze({
  db: 'sha256:b8aebc0a7bdcfd3eadc557f0d19999ee5f5d4a29590e03ba34d90acf783cbd92',
  ...coreCandidateImages('--exported-security-core-candidates', 'linux/amd64'),
  mailpit: 'axllent/mailpit@sha256:ed9b00c609e77e99c79b93f1178255ebc271868920f2c69a8d166bd5634ed10d',
  ...fullStackCandidateImages(true),
});

export function privateVariables(example, now = Date.now()) {
  const variables = { ...example };
  for (const key of ['POSTGRES_PASSWORD', 'JWT_SECRET', 'DASHBOARD_PASSWORD', 'PG_META_CRYPTO_KEY',
    'S3_PROTOCOL_ACCESS_KEY_SECRET', 'SECRET_KEY_BASE']) variables[key] = randomBytes(32).toString('hex');
  variables.REALTIME_DB_ENC_KEY = randomBytes(8).toString('hex');
  variables.VAULT_ENC_KEY = randomBytes(16).toString('hex');
  variables.OPENAI_API_KEY = '';
  variables.JWT_EXPIRY = '3600';
  const expires = Math.floor(now / 1000) + 90 * 86400;
  for (const [key, role] of [['ANON_KEY', 'anon'], ['SERVICE_ROLE_KEY', 'service_role']]) {
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const value = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ role, iss: 'supabase', iat: Math.floor(now / 1000), exp: expires })}`;
    variables[key] = `${value}.${createHmac('sha256', variables.JWT_SECRET).update(value).digest('base64url')}`;
  }
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { variables, keyExpiresAt: new Date(expires * 1000).toISOString(),
    meta: randomBytes(32).toString('hex'), verify: randomBytes(24).toString('hex'), cron: randomBytes(24).toString('hex'),
    cookie: randomBytes(32).toString('base64url'),
    flowPrivate: keys.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
    flowPublic: keys.publicKey.export({ format: 'pem', type: 'spki' }).toString() };
}

export function buildPrivateModel(rendered, settings, realtimeProfile) {
  validateCompose(rendered);
  const { variables: v } = settings;
  const labels = { [OWNER_LABEL]: APPROVED_SOURCE };
  const model = { name: PROJECT, services: {},
    networks: { default: { name: PROJECT, internal: true, labels } }, volumes: {} };
  for (const name of SERVICES.slice(0, 5)) {
    const service = structuredClone(rendered.services[name]);
    service.volumes = (service.volumes || []).map((mount) => {
      if (mount.type === 'bind' && mount.source.endsWith('.sql')) {
        const file = mount.source.split('/').at(-1);
        assert.ok(['realtime.sql', '_supabase.sql', 'logs.sql', 'webhooks.sql', 'pooler.sql', 'jwt.sql', 'roles.sql'].includes(file));
        return { type: 'bind', source: `${INSTALL_ROOT}/sql/${file}`, target: mount.target, read_only: true };
      }
      const key = mount.target === '/var/lib/storage' ? 'storage' : mount.target === '/etc/postgresql-custom' ? 'config'
        : mount.target === '/var/lib/postgresql/data' ? 'data' : null;
      assert.ok(key, 'Unreviewed mount');
      model.volumes[key] = { name: `${PROJECT}-${key}`, labels };
      return { type: 'volume', source: key, target: mount.target };
    });
    model.services[name] = service;
  }
  const restricted = { read_only: true, cap_drop: ['ALL'], security_opt: ['no-new-privileges:true'] };
  model.services.realtime = { ...structuredClone(rendered.services.realtime), ...restricted, ...realtimeProfile,
    volumes: [], environment: { ...rendered.services.realtime.environment, ...realtimeProfile.environment,
      ERL_AFLAGS: '-proto_dist inet_tcp', RELEASE_COOKIE: settings.cookie },
    healthcheck: { test: ['CMD', 'curl', '-q', '--noproxy', '*', '--proto', '=http', '--max-time', '5',
      '--fail', '--silent', '--output', '/dev/null', '--header', `Authorization: Bearer ${v.ANON_KEY}`,
      'http://localhost:4000/api/tenants/realtime-dev/health'], interval: '5s', timeout: '6s', retries: 30, start_period: '10s' } };
  model.services.functions = { ...restricted, user: '10001:10001', mem_limit: 805306368, volumes: [],
    tmpfs: ['/tmp:rw,noexec,nosuid,size=128m,uid=10001,gid=10001,mode=0700'],
    command: ['start', '--main-service', '/home/deno/bundles/main.eszip'],
    environment: { APP_ENV: 'staging', APP_URL: 'https://staging-barber.malabdullah.cloud',
      SUPABASE_URL: 'http://api-gw:8000', SUPABASE_ANON_KEY: v.ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: v.SERVICE_ROLE_KEY,
      JWT_SECRET: v.JWT_SECRET, CRON_SHARED_SECRET: settings.cron, WHATSAPP_APP_SECRET: settings.meta,
      WHATSAPP_VERIFY_TOKEN: settings.verify, WHATSAPP_FLOW_PRIVATE_KEY: settings.flowPrivate,
      WHATSAPP_ACCESS_TOKEN: '', WHATSAPP_PHONE_NUMBER_ID: '', OUTBOUND_RECIPIENT_ALLOWLIST: '',
      OPENAI_API_KEY: '', AI_OUTBOUND_ENABLED: 'false' } };
  const gatewayEnv = {};
  for (const key of ['ANON_KEY', 'SERVICE_ROLE_KEY', 'DASHBOARD_USERNAME', 'DASHBOARD_PASSWORD']) gatewayEnv[key] = v[key];
  for (const key of ['ANON_KEY_ASYMMETRIC', 'SERVICE_ROLE_KEY_ASYMMETRIC', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY']) gatewayEnv[key] = '';
  model.services['api-gw'] = { ...restricted, user: '10001:10001', mem_limit: 536870912, environment: gatewayEnv,
    entrypoint: ['/bin/sh'], command: ['/docker-entrypoint.sh', '--concurrency', '1'],
    tmpfs: ['/tmp:rw,noexec,nosuid,size=64m,uid=10001,gid=10001,mode=0700', '/etc/envoy:rw,noexec,nosuid,size=16m,uid=10001,gid=10001,mode=0700'],
    volumes: ['docker-entrypoint.sh', 'envoy.yaml', 'lds.template.yaml', 'cds.yaml'].map((file) => ({
      type: 'bind', source: `${INSTALL_ROOT}/gateway/${file}`,
      target: file === 'docker-entrypoint.sh' ? '/docker-entrypoint.sh' : `/etc/envoy/${file}`, read_only: true,
    })) };
  for (const [name, service] of Object.entries(model.services)) {
    Object.assign(service, { image: IMAGES[name], container_name: `${PROJECT}-${name}`, restart: 'unless-stopped',
      platform: 'linux/amd64', ports: [], networks: { default: {} }, labels, pull_policy: 'never',
      logging: { driver: 'json-file', options: { 'max-size': '10m', 'max-file': '3' } } });
    service.mem_limit ||= 1073741824;
    service.cpus ||= 1;
    service.pids_limit ||= 256;
  }
  validatePrivateModel(model);
  return model;
}

export function validatePrivateModel(model) {
  assert.equal(model.name, PROJECT);
  assert.deepEqual(Object.keys(model.services), SERVICES);
  assert.deepEqual(Object.keys(model.networks), ['default']);
  assert.deepEqual(model.networks.default, { name: PROJECT, internal: true, labels: { [OWNER_LABEL]: APPROVED_SOURCE } });
  assert.deepEqual(Object.keys(model.volumes).sort(), ['config', 'data', 'storage']);
  for (const [key, volume] of Object.entries(model.volumes)) {
    assert.deepEqual(volume, { name: `${PROJECT}-${key}`, labels: { [OWNER_LABEL]: APPROVED_SOURCE } });
  }
  for (const [name, service] of Object.entries(model.services)) {
    assert.equal(service.image, IMAGES[name]);
    assert.equal(service.container_name, `${PROJECT}-${name}`);
    assert.equal(service.platform, 'linux/amd64');
    assert.equal(service.pull_policy, 'never');
    assert.deepEqual(service.ports, []);
    assert.deepEqual(service.networks, { default: {} });
    assert.deepEqual(service.labels, { [OWNER_LABEL]: APPROVED_SOURCE });
    for (const key of ['privileged', 'network_mode', 'pid', 'ipc', 'devices', 'volumes_from', 'cap_add']) assert.ok(!service[key]);
    assert.ok(service.mem_limit > 0 && service.mem_limit <= 1073741824 && service.cpus <= 1 && service.pids_limit <= 256);
    for (const mount of service.volumes) {
      assert.ok(mount.type === 'volume' ? Object.hasOwn(model.volumes, mount.source)
        : mount.type === 'bind' && mount.read_only && mount.source.startsWith(`${INSTALL_ROOT}/${name === 'db' ? 'sql' : 'gateway'}/`)
          && !mount.source.includes('..') && ['db', 'api-gw'].includes(name));
    }
  }
  for (const name of ['realtime', 'functions', 'api-gw', 'mailpit']) {
    const service = model.services[name];
    assert.equal(service.user, name === 'realtime' ? '65534:65534' : '10001:10001');
    assert.equal(service.read_only, true);
    assert.deepEqual(service.cap_drop, ['ALL']);
    assert.deepEqual(service.security_opt, ['no-new-privileges:true']);
  }
  assert.equal(model.services.realtime.environment.ERL_AFLAGS, '-proto_dist inet_tcp');
  const functions = model.services.functions.environment;
  for (const key of ['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'OUTBOUND_RECIPIENT_ALLOWLIST', 'OPENAI_API_KEY']) assert.equal(functions[key], '');
  assert.equal(functions.AI_OUTBOUND_ENABLED, 'false');
  assert.equal(model.services.auth.environment.GOTRUE_SMTP_HOST, 'mailpit');
  assert.equal(model.services.auth.environment.GOTRUE_SMTP_PASS, '');
  assert.equal(model.services.db.command.at(-1), 'cron.launch_active_jobs=off');
  return true;
}
