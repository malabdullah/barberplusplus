import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveRelease } from './check-supabase-pin.mjs';
import { validateCompose } from './check-vps-compose.mjs';

test('annotated releases resolve to source commits, not tag objects', () => {
  const tag = 'a'.repeat(40);
  const commit = 'b'.repeat(40);
  assert.equal(resolveRelease(`${tag}\trefs/tags/self-hosted/v0.8.0\n${commit}\trefs/tags/self-hosted/v0.8.0^{}`, 'self-hosted/v0.8.0'), commit);
  assert.equal(resolveRelease(`${commit}\trefs/tags/self-hosted/v0.8.0`, 'self-hosted/v0.8.0'), commit);
  assert.throws(() => resolveRelease('', 'self-hosted/v0.8.0'));
});

function fixture() {
  const services = {};
  for (const name of ['studio', 'api-gw', 'auth', 'rest', 'realtime', 'storage', 'imgproxy', 'meta', 'functions', 'db', 'supavisor']) {
    services[name] = {
      container_name: name === 'realtime' ? 'realtime-dev.barber-staging-realtime'
        : `barber-staging-${name === 'supavisor' ? 'pooler' : name}`,
      image: 'fixture/service:1.0.0', networks: { default: null }, environment: {},
    };
  }
  services['api-gw'].ports = [{ host_ip: '127.0.0.1', published: '18000', target: 8000, protocol: 'tcp' }];
  services.db.ports = [{ host_ip: '127.0.0.1', published: '15432', target: 5432, protocol: 'tcp' }];
  services.auth.environment = {
    GOTRUE_SITE_URL: 'https://staging-barber.malabdullah.cloud',
    API_EXTERNAL_URL: 'https://supabase-staging.malabdullah.cloud/auth/v1',
    GOTRUE_DISABLE_SIGNUP: 'true', GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED: 'false',
    GOTRUE_EXTERNAL_PHONE_ENABLED: 'false',
    GOTRUE_SMTP_HOST: 'smtp-disabled.invalid', GOTRUE_SMTP_PORT: '1025',
    GOTRUE_SMTP_USER: '', GOTRUE_SMTP_PASS: '',
  };
  services.functions.environment = {
    APP_ENV: 'staging', APP_URL: 'https://staging-barber.malabdullah.cloud',
    OUTBOUND_RECIPIENT_ALLOWLIST: '', WHATSAPP_ACCESS_TOKEN: '', ANTHROPIC_API_KEY: '',
  };
  return { name: 'barber-staging', services,
    networks: { default: { name: 'barber-staging-internal' } },
    volumes: { 'db-config': { name: 'barber-staging-db-config' }, 'deno-cache': { name: 'barber-staging-deno-cache' } } };
}

test('accepts the isolated initial topology', () => validateCompose(fixture()));
const unsafeChanges = {
  'wildcard API binding': (c) => { c.services['api-gw'].ports[0].host_ip = '0.0.0.0'; },
  'IPv6 public binding': (c) => { c.services.db.ports[0].host_ip = '::'; },
  'extra pooler binding': (c) => { c.services.supavisor.ports = [{ published: '6543' }]; },
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
  'anonymous signup': (c) => { c.services.auth.environment.GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED = 'true'; },
  'external SMTP provider': (c) => { c.services.auth.environment.GOTRUE_SMTP_HOST = 'smtp.production.invalid'; },
  'live integration credential': (c) => { c.services.functions.environment.ANTHROPIC_API_KEY = 'not-a-real-key'; },
  'unknown service': (c) => { c.services.unknown = c.services.db; },
};
for (const [name, change] of Object.entries(unsafeChanges)) {
  test(`rejects ${name}`, () => {
    const config = fixture(); change(config);
    assert.throws(() => validateCompose(config));
  });
}
