import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const MAILPIT_IMAGE = 'axllent/mailpit:v1.31.3@sha256:ed9b00c609e77e99c79b93f1178255ebc271868920f2c69a8d166bd5634ed10d';
export const MAILPIT_ENV = {
  MP_DATABASE: '/tmp/mailpit.db', MP_MAX_MESSAGES: '1000', MP_MAX_AGE: '7d',
  MP_MAX_MESSAGE_SIZE: '5', MP_SMTP_ALLOWED_RECIPIENTS: '^[A-Za-z0-9._+-]+@barber\\.test\\z',
  MP_SMTP_DISABLE_RDNS: 'true', MP_DISABLE_VERSION_CHECK: 'true',
  MP_BLOCK_REMOTE_CSS_AND_FONTS: 'true', MP_ENABLE_SPAMASSASSIN: 'false',
  MP_LABEL: 'Barber++ staging — synthetic mail only',
};

// Accept rendered Compose JSON on stdin; never echo it (it may contain secrets).
// This validates topology, not credentials, application health, or readiness.
export function validateCompose(config, { requireCompiledFunctions = false } = {}) {
  const fail = (message) => { throw new Error(message); };
  if (config.name !== 'barber-staging') fail('Unexpected project name');
  const compiled = requireCompiledFunctions || config.services?.functions?.image?.startsWith('ghcr.io/malabdullah/barberplusplus-functions');
  const names = ['studio', 'api-gw', 'auth', 'rest', 'realtime', 'storage', 'imgproxy', 'meta', 'functions', 'db', 'supavisor', 'mailpit'];
  if (Object.keys(config.services || {}).sort().join() !== [...names].sort().join()) fail('Unexpected service inventory');
  for (const [name, service] of Object.entries(config.services)) {
    const expectedName = name === 'realtime' ? 'realtime-dev.barber-staging-realtime'
      : `barber-staging-${name === 'supavisor' ? 'pooler' : name}`;
    if (service.container_name !== expectedName) fail(`Unexpected container name: ${name}`);
    if (!service.image || !/(:[^/:]+|@sha256:[a-f0-9]{64})$/.test(service.image)
      || /:latest$/.test(service.image)) fail(`Unpinned image: ${name}`);
    if (service.privileged || service.network_mode || service.pid || service.cap_add?.length
      || service.devices?.length) fail(`Unexpected elevated access: ${name}`);
    const expectedNetworks = name === 'mailpit' ? 'mail-sink' : name === 'auth' ? 'default,mail-sink' : 'default';
    if (Object.keys(service.networks || {}).sort().join() !== expectedNetworks) fail(`Unexpected network: ${name}`);
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
  if (Object.keys(config.networks || {}).sort().join() !== 'default,mail-sink'
    || config.networks.default.name !== 'barber-staging-internal'
    || config.networks.default.external) fail('Unexpected or shared network');
  const sinkNetwork = config.networks['mail-sink'];
  if (sinkNetwork.name !== 'barber-staging-mail-sink' || sinkNetwork.internal !== true
    || sinkNetwork.external || sinkNetwork.driver_opts || sinkNetwork.driver) fail('Mail sink network is not isolated');
  const sink = config.services.mailpit;
  if (sink.image !== MAILPIT_IMAGE || sink.user !== '10001:10001' || sink.read_only !== true
    || sink.cap_drop?.join() !== 'ALL' || sink.security_opt?.join() !== 'no-new-privileges:true'
    || sink.volumes?.length || sink.command || sink.entrypoint || sink.env_file
    || sink.configs?.length || sink.secrets?.length || sink.extra_hosts || sink.dns
    || sink.tmpfs?.join() !== '/tmp:rw,noexec,nosuid,size=128m,uid=10001,gid=10001,mode=0700'
    || Number(sink.mem_limit) !== 268435456 || Number(sink.cpus) !== 0.5 || sink.pids_limit !== 100) fail('Unsafe mail sink configuration');
  if (Object.keys(sink.environment || {}).sort().join() !== Object.keys(MAILPIT_ENV).sort().join()
    || Object.entries(MAILPIT_ENV).some(([key, value]) => sink.environment[key] !== value)) fail('Unsafe mail sink environment');
  if (Object.keys(config.volumes || {}).sort().join() !== (compiled ? 'db-config' : 'db-config,deno-cache')) fail('Unexpected volumes');
  for (const [name, volume] of Object.entries(config.volumes)) {
    if (volume.external || volume.name !== `barber-staging-${name}` || volume.driver_opts) fail('Unexpected or shared volume');
  }
  const auth = config.services.auth.environment;
  if (auth.GOTRUE_SITE_URL !== 'https://staging-barber.malabdullah.cloud'
    || auth.API_EXTERNAL_URL !== 'https://supabase-staging.malabdullah.cloud/auth/v1'
    || auth.GOTRUE_DISABLE_SIGNUP !== 'true'
    || auth.GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED !== 'false'
    || auth.GOTRUE_EXTERNAL_PHONE_ENABLED !== 'false'
    || auth.GOTRUE_SMTP_HOST !== 'mailpit'
    || auth.GOTRUE_SMTP_PORT !== '1025'
    || auth.GOTRUE_SMTP_ADMIN_EMAIL !== 'no-reply@barber.test'
    || auth.GOTRUE_SMTP_USER !== '' || auth.GOTRUE_SMTP_PASS !== '') fail('Unsafe staging Auth configuration');
  const functions = config.services.functions.environment;
  if (functions.APP_ENV !== 'staging' || functions.APP_URL !== 'https://staging-barber.malabdullah.cloud'
    || functions.VERIFY_JWT !== 'true'
    || functions.OUTBOUND_RECIPIENT_ALLOWLIST !== '' || functions.WHATSAPP_ACCESS_TOKEN !== ''
    || functions.OPENAI_API_KEY !== '' || functions.AI_OUTBOUND_ENABLED !== 'false'
    || functions.ANTHROPIC_API_KEY) fail('Initial integration quarantine is not enabled');
  const service = config.services.functions;
  if (compiled) {
    validateCompiledFunctions(service);
  } else {
    const codeMount = service.volumes?.find((mount) => mount.target === '/home/deno/functions');
    if (!codeMount || codeMount.type !== 'bind' || codeMount.read_only !== true
      || codeMount.source !== '/opt/barber-staging/supabase/volumes/functions') fail('Function code must use the read-only staging mount');
  }
}

export function validateCompiledFunctions(service) {
  if (!/^ghcr\.io\/malabdullah\/barberplusplus-functions@sha256:[a-f0-9]{64}$/.test(service.image)
    || service.volumes?.length || service.entrypoint || service.configs?.length || service.secrets?.length
    || service.user !== '10001:10001' || service.read_only !== true
    || service.cap_drop?.join() !== 'ALL' || service.security_opt?.join() !== 'no-new-privileges:true'
    || service.command?.join() !== 'start,--main-service,/home/deno/bundles/main.eszip'
    || service.tmpfs?.join() !== '/tmp:rw,noexec,nosuid,size=128m,uid=10001,gid=10001,mode=0700'
    || Number(service.mem_limit) !== 805306368 || Number(service.cpus) !== 1 || service.pids_limit !== 256) {
    throw new Error('Compiled functions require the approved digest, non-root read-only runtime and no source mounts');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length > 3 || (process.argv[2] && process.argv[2] !== '--compiled-functions')) throw new Error('Unknown Compose validation option');
    validateCompose(JSON.parse(readFileSync(0, 'utf8')), { requireCompiledFunctions: process.argv[2] === '--compiled-functions' });
    console.log('VPS Compose topology passed; credentials and deployment readiness remain separate gates.');
  } catch (error) {
    // Do not print input, parser errors, or environment values.
    console.error(error instanceof SyntaxError ? 'Invalid Compose JSON' : error.message);
    process.exitCode = 1;
  }
}
