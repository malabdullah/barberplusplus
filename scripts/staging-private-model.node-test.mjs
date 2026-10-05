import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHmac } from 'node:crypto';
import { APPROVED_SOURCE, PROJECT, OWNER_LABEL, SERVICES, IMAGES, privateVariables, validatePrivateModel } from './staging-private-model.mjs';

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
  return model;
}

test('approved private model has exact eight identities and no shared infrastructure', () => validatePrivateModel(fixture()));
for (const [name, change] of Object.entries({
  'changed project': (m) => { m.name = 'production'; },
  'extra service': (m) => { m.services.extra = m.services.db; },
  'mutable image': (m) => { m.services.auth.image = 'supabase/gotrue:latest'; },
  'registry fallback': (m) => { m.services.db.pull_policy = 'always'; },
  'published port': (m) => { m.services.db.ports = [{ published: '5432' }]; },
  'external route': (m) => { m.networks.default.internal = false; },
  'extra network': (m) => { m.services.auth.networks.external = {}; },
  'reused volume': (m) => { m.volumes.data.name = 'production-data'; },
  'Docker socket': (m) => { m.services.functions.volumes = [{ type: 'bind', source: '/var/run/docker.sock' }]; },
  'host namespace': (m) => { m.services.storage.network_mode = 'host'; },
  'privilege': (m) => { m.services.realtime.privileged = true; },
  'added capability': (m) => { m.services.realtime.cap_add = ['SYS_ADMIN']; },
  'root function': (m) => { m.services.functions.user = '0:0'; },
  'writable root': (m) => { m.services['api-gw'].read_only = false; },
  'unbounded RAM': (m) => { m.services.db.mem_limit = 0; },
  'native emulation flag': (m) => { m.services.realtime.environment.ERL_AFLAGS += ' +JMsingle true'; },
  'outbound token': (m) => { m.services.functions.environment.WHATSAPP_ACCESS_TOKEN = 'fixture'; },
  'AI outbound': (m) => { m.services.functions.environment.AI_OUTBOUND_ENABLED = 'true'; },
  'external SMTP': (m) => { m.services.auth.environment.GOTRUE_SMTP_HOST = 'outside.invalid'; },
  'active cron': (m) => { m.services.db.command = ['postgres']; },
})) test(`private bootstrap rejects ${name}`, () => { const model = fixture(); change(model); assert.throws(() => validatePrivateModel(model)); });

test('fresh secrets and synthetic integration keys are independent; service JWT expiry is recorded', () => {
  const now = Date.UTC(2026, 9, 5);
  const first = privateVariables({}, now); const second = privateVariables({}, now);
  for (const name of ['POSTGRES_PASSWORD', 'JWT_SECRET', 'VAULT_ENC_KEY', 'SERVICE_ROLE_KEY', 'ANON_KEY']) {
    assert.notEqual(first.variables[name], second.variables[name]);
    assert.ok(first.variables[name].length >= 32);
  }
  for (const key of ['meta', 'verify', 'cron', 'cookie', 'flowPrivate']) assert.notEqual(first[key], second[key]);
  assert.equal(first.variables.OPENAI_API_KEY, '');
  assert.equal(first.variables.JWT_EXPIRY, '3600');
  const [header, payload, signature] = first.variables.SERVICE_ROLE_KEY.split('.');
  const claims = JSON.parse(Buffer.from(payload, 'base64url'));
  assert.equal(claims.role, 'service_role');
  assert.equal(claims.exp - claims.iat, 90 * 86400);
  assert.equal(new Date(claims.exp * 1000).toISOString(), first.keyExpiresAt);
  assert.equal(signature, createHmac('sha256', first.variables.JWT_SECRET).update(`${header}.${payload}`).digest('base64url'));
});
