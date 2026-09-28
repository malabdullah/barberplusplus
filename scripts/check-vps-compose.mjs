import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Accept rendered Compose JSON on stdin; never echo it (it may contain secrets).
// This validates topology, not credentials, application health, or readiness.
export function validateCompose(config) {
  const fail = (message) => { throw new Error(message); };
  if (config.name !== 'barber-staging') fail('Unexpected project name');
  const names = ['studio', 'api-gw', 'auth', 'rest', 'realtime', 'storage', 'imgproxy', 'meta', 'functions', 'db', 'supavisor'];
  if (Object.keys(config.services || {}).sort().join() !== [...names].sort().join()) fail('Unexpected service inventory');
  for (const [name, service] of Object.entries(config.services)) {
    const expectedName = name === 'realtime' ? 'realtime-dev.barber-staging-realtime'
      : `barber-staging-${name === 'supavisor' ? 'pooler' : name}`;
    if (service.container_name !== expectedName) fail(`Unexpected container name: ${name}`);
    if (!service.image || !/(:[^/:]+|@sha256:[a-f0-9]{64})$/.test(service.image)
      || /:latest$/.test(service.image)) fail(`Unpinned image: ${name}`);
    if (service.privileged || service.network_mode || service.pid || service.cap_add?.length
      || service.devices?.length) fail(`Unexpected elevated access: ${name}`);
    if (Object.keys(service.networks || {}).join() !== 'default') fail(`Unexpected network: ${name}`);
    const ports = service.ports || [];
    const expectedPort = name === 'api-gw' ? [18000, 8000] : name === 'db' ? [15432, 5432] : null;
    if (ports.length !== (expectedPort ? 1 : 0)) fail(`Unexpected published ports: ${name}`);
    for (const port of ports) {
      if (port.host_ip !== '127.0.0.1' || Number(port.published) !== expectedPort[0]
        || Number(port.target) !== expectedPort[1] || port.protocol !== 'tcp') fail(`Unsafe published port: ${name}`);
    }
    for (const mount of service.volumes || []) {
      if (mount.type === 'bind') {
        if (!mount.source.startsWith('/opt/barber-staging/supabase/volumes/')
          || mount.source.split('/').includes('..')) fail(`Non-staging bind mount: ${name}`);
      } else if (mount.type !== 'volume' || !['db-config', 'deno-cache'].includes(mount.source)) {
        fail(`Unexpected volume: ${name}`);
      }
    }
  }
  if (Object.keys(config.networks || {}).join() !== 'default'
    || config.networks.default.name !== 'barber-staging-internal'
    || config.networks.default.external) fail('Unexpected or shared network');
  if (Object.keys(config.volumes || {}).sort().join() !== 'db-config,deno-cache') fail('Unexpected volumes');
  for (const [name, volume] of Object.entries(config.volumes)) {
    if (volume.external || volume.name !== `barber-staging-${name}` || volume.driver_opts) fail('Unexpected or shared volume');
  }
  const auth = config.services.auth.environment;
  if (auth.GOTRUE_SITE_URL !== 'https://staging-barber.malabdullah.cloud'
    || auth.API_EXTERNAL_URL !== 'https://supabase-staging.malabdullah.cloud/auth/v1'
    || auth.GOTRUE_DISABLE_SIGNUP !== 'true'
    || auth.GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED !== 'false'
    || auth.GOTRUE_EXTERNAL_PHONE_ENABLED !== 'false'
    || auth.GOTRUE_SMTP_HOST !== 'smtp-disabled.invalid'
    || auth.GOTRUE_SMTP_PORT !== '1025'
    || auth.GOTRUE_SMTP_USER !== '' || auth.GOTRUE_SMTP_PASS !== '') fail('Unsafe staging Auth configuration');
  const functions = config.services.functions.environment;
  if (functions.APP_ENV !== 'staging' || functions.APP_URL !== 'https://staging-barber.malabdullah.cloud'
    || functions.OUTBOUND_RECIPIENT_ALLOWLIST !== '' || functions.WHATSAPP_ACCESS_TOKEN !== ''
    || functions.ANTHROPIC_API_KEY !== '') fail('Initial integration quarantine is not enabled');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    validateCompose(JSON.parse(readFileSync(0, 'utf8')));
    console.log('VPS Compose topology passed; credentials and deployment readiness remain separate gates.');
  } catch (error) {
    // Do not print input, parser errors, or environment values.
    console.error(error instanceof SyntaxError ? 'Invalid Compose JSON' : error.message);
    process.exitCode = 1;
  }
}
