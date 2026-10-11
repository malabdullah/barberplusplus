import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { privateVariables, APPROVED_SOURCE, PROJECT, OWNER_LABEL, SERVICES, IMAGES } from './staging-private-model.mjs';
import { manualFirstRelease as release, prepareManualFirstRelease } from './staging-manual-first-release.mjs';

const now = Date.UTC(2026, 9, 8);
const templates = { runtime: readFileSync('docker/runtime-config.js.template', 'utf8'), nginx: readFileSync('docker/nginx.conf.template', 'utf8') };
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
  const { variables: v } = privateVariables({}, now);
  model.services.realtime.environment.ERL_AFLAGS = '-proto_dist inet_tcp';
  model.services.functions.environment = { APP_ENV: 'staging', APP_URL: release.appUrl, SUPABASE_URL: 'http://api-gw:8000',
    SUPABASE_ANON_KEY: v.ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: v.SERVICE_ROLE_KEY, JWT_SECRET: v.JWT_SECRET,
    WHATSAPP_ACCESS_TOKEN: '', WHATSAPP_PHONE_NUMBER_ID: '', OUTBOUND_RECIPIENT_ALLOWLIST: '', OPENAI_API_KEY: '', AI_OUTBOUND_ENABLED: 'false' };
  model.services['api-gw'].environment.ANON_KEY = v.ANON_KEY;
  model.services.auth.environment = { GOTRUE_SMTP_HOST: 'mailpit', GOTRUE_SMTP_PASS: '', API_EXTERNAL_URL: `${release.apiUrl}/auth/v1`, GOTRUE_SITE_URL: release.appUrl };
  model.services.db.command = ['postgres', '-c', 'cron.launch_active_jobs=off'];
  return model;
}

test('manual candidate changes only Functions and gateway loopback binding; original stays unchanged', () => {
  const model = fixture(); const before = structuredClone(model);
  const result = prepareManualFirstRelease(model, templates, now);
  assert.deepEqual(model, before);
  assert.equal(result.deploymentAuthorized, false);
  for (const service of SERVICES.filter(name => !['functions', 'api-gw'].includes(name))) {
    assert.deepEqual(result.backend.services[service], before.services[service]);
  }
  assert.equal(result.backend.services.functions.image, release.functions);
  assert.deepEqual(result.backend.services['api-gw'].ports, [{ target: 8000, published: '54331', host_ip: '127.0.0.1', protocol: 'tcp' }]);
  assert.deepEqual(result.backend.volumes, before.volumes);
  assert.deepEqual(result.backend.networks, before.networks);
});
test('frontend is isolated, non-root, read-only, bounded and receives no server credentials', () => {
  const model = fixture(); const result = prepareManualFirstRelease(model, templates, now);
  const front = result.frontend.services.frontend;
  assert.equal(front.image, release.frontend); assert.equal(front.user, '101:101');
  assert.equal(front.read_only, true); assert.deepEqual(front.cap_drop, ['ALL']);
  assert.equal(result.frontend.networks.default.internal, true);
  assert.equal(front.ports[0].host_ip, '127.0.0.1');
  assert.ok(front.volumes.every(mount => mount.read_only && mount.source.startsWith(`${release.root}/`)));
  assert.equal(front.environment, undefined);
  assert.ok(result.runtime.includes(model.services.functions.environment.SUPABASE_ANON_KEY));
  for (const key of ['SUPABASE_SERVICE_ROLE_KEY', 'JWT_SECRET']) assert.ok(!result.runtime.includes(model.services.functions.environment[key]));
  assert.ok(result.nginx.includes('noindex, nofollow') && result.nginx.includes('no-store'));
});
test('manual preparation denies unsafe source configuration and browser-key substitution', () => {
  for (const mutate of [
    m => { m.services.functions.environment.SUPABASE_ANON_KEY = m.services.functions.environment.SUPABASE_SERVICE_ROLE_KEY; },
    m => { m.services.functions.environment.JWT_SECRET = 'different'; },
    m => { m.services['api-gw'].environment.ANON_KEY = 'different'; },
    m => { m.services.functions.environment.APP_ENV = 'production'; },
    m => { m.services.auth.environment.API_EXTERNAL_URL = 'https://other.invalid'; },
    m => { m.services.functions.environment.OPENAI_API_KEY = 'must-remain-quarantined'; },
    m => { m.services.db.ports = [{ published: '5432' }]; },
  ]) { const model = fixture(); mutate(model); assert.throws(() => prepareManualFirstRelease(model, templates, now)); }
  assert.throws(() => prepareManualFirstRelease(fixture(), templates, now + 91 * 86400000));
});
test('unknown template variables and absent runtime identity fail closed', () => {
  assert.throws(() => prepareManualFirstRelease(fixture(), { ...templates, runtime: '${UNKNOWN}' }, now));
  assert.throws(() => prepareManualFirstRelease(fixture(), { ...templates, runtime: 'window.config={}' }, now));
});
