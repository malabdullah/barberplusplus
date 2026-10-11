import assert from 'node:assert/strict';
import { privateVariables } from './staging-private-model.mjs';

// Recorded topology in; fresh disposable credentials and volumes out. No DB I/O.
export function syntheticRebuildModel(backend, frontend, project, directory) {
  assert.match(project, /^barber-test-rebuild-[a-f0-9]{16}$/);
  assert.ok(directory.startsWith('/tmp/barber-test-rebuild-') || directory.startsWith('/private/tmp/barber-test-rebuild-'));
  const settings = privateVariables({ DASHBOARD_USERNAME: 'synthetic' });
  const v = settings.variables; const old = backend.services;
  const replacements = new Map([
    [old.db.environment.POSTGRES_PASSWORD, v.POSTGRES_PASSWORD], [old.functions.environment.JWT_SECRET, v.JWT_SECRET],
    [old.functions.environment.SUPABASE_ANON_KEY, v.ANON_KEY], [old.functions.environment.SUPABASE_SERVICE_ROLE_KEY, v.SERVICE_ROLE_KEY],
    [old.realtime.environment.DB_ENC_KEY, v.REALTIME_DB_ENC_KEY], [old.realtime.environment.SECRET_KEY_BASE, v.SECRET_KEY_BASE],
    [old.realtime.environment.RELEASE_COOKIE, settings.cookie], [old.storage.environment.S3_PROTOCOL_ACCESS_KEY_SECRET, v.S3_PROTOCOL_ACCESS_KEY_SECRET],
    [old.storage.environment.S3_PROTOCOL_ACCESS_KEY_ID, v.S3_PROTOCOL_ACCESS_KEY_SECRET.slice(0, 20)],
    [old['api-gw'].environment.DASHBOARD_PASSWORD, v.DASHBOARD_PASSWORD],
    [old.functions.environment.CRON_SHARED_SECRET, settings.cron], [old.functions.environment.WHATSAPP_APP_SECRET, settings.meta],
    [old.functions.environment.WHATSAPP_VERIFY_TOKEN, settings.verify], [old.functions.environment.WHATSAPP_FLOW_PRIVATE_KEY, settings.flowPrivate],
  ]);
  for (const [source, target] of replacements) assert.ok(typeof source === 'string' && source.length >= 8 && source !== target);
  const replace = value => {
    if (typeof value === 'string') {
      for (const [source, target] of [...replacements].sort((a, b) => b[0].length - a[0].length)) value = value.replaceAll(source, target);
      return value;
    }
    if (Array.isArray(value)) return value.map(replace);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, item]) => [k, replace(item)]));
    return value;
  };
  const model = replace(structuredClone(backend)); model.services.frontend = structuredClone(frontend.services.frontend);
  const labels = { 'cloud.malabdullah.barber.synthetic-rebuild': project };
  model.name = project; model.networks = { default: { name: project, internal: true, labels } };
  for (const [key, volume] of Object.entries(model.volumes)) Object.assign(volume, { name: `${project}-${key}`, labels });
  const limits = { db: 768, auth: 256, rest: 192, storage: 384, mailpit: 64, realtime: 768, functions: 384, 'api-gw': 192, frontend: 128 };
  for (const [name, service] of Object.entries(model.services)) {
    service.container_name = `${project}-${name}`; service.labels = labels; service.restart = 'no';
    service.ports = []; service.networks = { default: {} }; service.cpus = Math.min(service.cpus, 0.5);
    service.mem_limit = Math.min(Number(service.mem_limit), limits[name] * 1048576);
    for (const mount of service.volumes) if (mount.type === 'bind') {
      const file = mount.source.split('/').at(-1);
      mount.source = `${directory}/${name === 'db' ? 'sql/' : name === 'api-gw' ? 'gateway/' : ''}${file}`;
      assert.equal(mount.read_only, true);
    }
    if (service.depends_on) for (const dependency of Object.keys(service.depends_on)) assert.ok(Object.hasOwn(model.services, dependency));
  }
  assert.equal(model.services.functions.environment.JWT_SECRET, v.JWT_SECRET);
  assert.equal(model.services.realtime.environment.ERL_AFLAGS, '-proto_dist inet_tcp');
  assert.equal(model.services.functions.environment.AI_OUTBOUND_ENABLED, 'false');
  for (const key of ['OPENAI_API_KEY', 'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'OUTBOUND_RECIPIENT_ALLOWLIST']) assert.equal(model.services.functions.environment[key], '');
  assert.equal(model.services.auth.environment.GOTRUE_SMTP_HOST, 'mailpit');
  return { model, settings, replacements, maximumMemoryBytes: Object.values(model.services).reduce((sum, s) => sum + s.mem_limit, 0) };
}
