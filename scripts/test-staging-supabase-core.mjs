// Disposable local compatibility test, never a deployment or live-stack reset.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { validateCompose } from './check-vps-compose.mjs';
import { inspectCandidate, inspectPlatformImage } from './staging-postgres-candidate.mjs';
import { prepareStagingFixtures } from './staging-fixtures.mjs';
import { isPrivateStorageDenied, rehearseCoreRecovery } from './rehearse-staging-core-recovery.mjs';

const upstream = realpathSync(process.argv[2] || 'missing-upstream-directory');
const platform = process.argv[3] || 'linux/amd64';
assert.ok(['linux/amd64', 'linux/arm64'].includes(platform) && process.argv.length <= 5);
const project = `barber-core-probe-${randomBytes(8).toString('hex')}`;
const label = 'barber.staging.core-probe';
const env = { PATH: process.env.PATH, HOME: process.env.HOME };
let model;
let started = false;
let stage = 'preflight';
const redactions = [];
const docker = (args, options = {}) => execFileSync('docker', args, {
  env, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
  timeout: 30000, maxBuffer: 8 * 1024 * 1024, ...options,
});
const compose = (args, options = {}) => docker([
  'compose', '--project-directory', upstream, '-p', project, '-f', '-', ...args,
], { input: JSON.stringify(model), ...options });
const sql = (input) => docker(['exec', '-i', '-u', 'postgres', `${project}-db`,
  'psql', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-d', 'postgres'], { input }).trim();

try {
  const context = docker(['context', 'show']).trim();
  const [contextInfo] = JSON.parse(docker(['context', 'inspect', context]));
  assert.ok(contextInfo.Endpoints.docker.Host.startsWith('unix://'), 'Local Docker only');
  const pin = readFileSync('ops/supabase/self-hosted.commit', 'utf8').trim();
  assert.equal(readFileSync(`${upstream}/.supabase-version`, 'utf8').trim(), `ref=${pin}`);
  assert.ok(readFileSync('supabase/.baseline-ready', 'utf8').includes('verified'));
  assert.ok(readFileSync('supabase/schema.expected.sql', 'utf8').length > 1000);
  const variables = parseEnv(readFileSync(`${upstream}/.env.example`, 'utf8'));
  for (const key of ['POSTGRES_PASSWORD', 'JWT_SECRET', 'DASHBOARD_PASSWORD',
    'PG_META_CRYPTO_KEY', 'S3_PROTOCOL_ACCESS_KEY_SECRET', 'SECRET_KEY_BASE']) {
    variables[key] = randomBytes(32).toString('hex');
  }
  variables.REALTIME_DB_ENC_KEY = randomBytes(8).toString('hex');
  variables.VAULT_ENC_KEY = randomBytes(16).toString('hex');
  variables.OPENAI_API_KEY = '';
  const jwt = (role) => {
    const part = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const value = `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ role,
      iss: 'supabase', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 })}`;
    return `${value}.${createHmac('sha256', variables.JWT_SECRET).update(value).digest('base64url')}`;
  };
  variables.ANON_KEY = jwt('anon');
  variables.SERVICE_ROLE_KEY = jwt('service_role');
  redactions.push(...Object.entries(variables).filter(([key]) => /PASSWORD|SECRET|KEY|TOKEN/.test(key))
    .map(([, value]) => value).filter(Boolean));
  const rendered = JSON.parse(docker(['compose', '--project-directory', '/opt/barber-staging/supabase',
    '--env-file', `${upstream}/.env.example`, '-f', `${upstream}/docker-compose.yml`,
    '-f', resolve('ops/staging-vps/compose.override.yml'), 'config', '--format', 'json'],
  { env: { ...env, ...variables } }));
  validateCompose(rendered);
  const candidateId = process.argv[4] ? inspectCandidate(docker, process.argv[4], platform) : null;
  const services = ['db', 'auth', 'rest', 'storage', 'imgproxy', 'mailpit'];
  model = { name: project, services: {},
    networks: { default: { name: project, internal: true, labels: { [label]: project } } },
    volumes: {} };
  for (const name of services) {
    const service = structuredClone(rendered.services[name]);
    service.container_name = `${project}-${name}`;
    service.restart = 'no';
    service.platform = platform;
    service.ports = [];
    service.networks = { default: {} };
    service.labels = { [label]: project };
    service.volumes = (service.volumes || []).map((mount) => {
      if (mount.type === 'bind' && mount.source.endsWith('.sql')) {
        const relative = mount.source.replace('/opt/barber-staging/supabase/', '');
        const source = realpathSync(resolve(upstream, relative));
        assert.ok(source.startsWith(`${upstream}/volumes/db/`));
        return { type: 'bind', source, target: mount.target, read_only: true };
      }
      const key = mount.target === '/var/lib/storage' ? 'storage'
        : mount.target === '/etc/postgresql-custom' ? 'config'
          : mount.target === '/var/lib/postgresql/data' ? 'data' : null;
      assert.ok(key, 'Unexpected mount');
      model.volumes[key] = { name: `${project}-${key}`, labels: { [label]: project } };
      return { type: 'volume', source: key, target: mount.target };
    });
    service.mem_limit ||= 1073741824;
    service.cpus ||= 1;
    service.pids_limit ||= 256;
    model.services[name] = service;
  }
  stage = 'candidate image pulls';
  for (const [name, service] of Object.entries(model.services)) {
    if (name === 'db' && candidateId) {
      service.image = candidateId;
      service.pull_policy = 'never';
      console.log(`db: locally validated candidate ${candidateId}`);
      continue;
    }
    console.log(`Preparing ${name} (${platform})`);
    stage = `image pull (${name})`;
    docker(['pull', '--platform', platform, service.image], { timeout: 300000 });
    stage = `image metadata (${name})`;
    const metadata = inspectPlatformImage(docker, service.image, platform);
    const repository = service.image.split('@')[0].replace(/:[^/]+$/, '');
    const immutable = metadata.RepoDigests.find((ref) => ref.startsWith(`${repository}@sha256:`));
    assert.ok(immutable, 'Missing immutable image identity');
    service.image = immutable;
    console.log(`${name}: ${immutable}`);
  }
  stage = 'isolated core startup';
  started = true;
  console.log('Starting fresh core services on an internal-only network; no ports published.');
  compose(['up', '-d', '--wait', '--wait-timeout', '240'], { timeout: 300000 });
  for (const name of services) {
    stage = `isolation inspection (${name})`;
    const [container] = JSON.parse(docker(['inspect', `${project}-${name}`]));
    assert.equal(container.Config.Labels[label], project, 'probe label mismatch');
    assert.equal(Object.keys(container.HostConfig.PortBindings || {}).length, 0, 'published ports found');
    assert.deepEqual(Object.keys(container.NetworkSettings.Networks), [project], 'network mismatch');
    assert.ok(container.Mounts.every((mount) => mount.Type === 'volume'
      ? mount.Name.startsWith(`${project}-`)
      : mount.Type === 'tmpfs' && name === 'mailpit' && mount.Destination === '/tmp'
        || mount.Type === 'bind' && !mount.RW && model.services[name].volumes.some((expected) =>
          expected.type === 'bind' && expected.target === mount.Destination
          // Docker Desktop can report its VM-side /host_mnt prefix.
          && [expected.source, `/host_mnt${expected.source}`].includes(mount.Source))), 'mount isolation mismatch');
  }
  assert.equal(JSON.parse(docker(['network', 'inspect', project]))[0].Internal, true);
  assert.equal(sql('SHOW server_version_num;'), '170011');
  assert.equal(sql('SHOW cron.launch_active_jobs;'), 'off');
  stage = 'application migration replay';
  const migrations = readdirSync('supabase/migrations').filter((name) => name.endsWith('.sql')).sort();
  assert.ok(migrations.length && migrations.every((name) => /^\d{14}_[a-z0-9_]+\.sql$/.test(name)));
  for (const migration of migrations) {
    sql(readFileSync(`supabase/migrations/${migration}`, 'utf8'));
    console.log(`Replayed ${migration}`);
  }
  stage = 'random-password staging fixture rehearsal';
  const fixtures = prepareStagingFixtures();
  redactions.push(...fixtures.accounts.map((account) => account.password));
  // A Vault-only blocker must reject before any seed insert. Without the guard,
  // this would succeed (no duplicate fixture keys), so it tests the actual gate.
  let rejectedVaultOnly = false;
  try {
    sql(`BEGIN; SELECT vault.create_secret('synthetic-guard-only', 'fixture_guard_probe');\n${fixtures.sql}`);
  } catch (error) {
    rejectedVaultOnly = String(error.stderr || '').includes('ERROR:  Fixture gate: database must be empty');
  }
  assert.ok(rejectedVaultOnly, 'Fixture must reject a Vault-only nonempty target');
  assert.equal(sql('SELECT count(*) FROM auth.users;'), '0');
  assert.equal(sql('SELECT count(*) FROM vault.secrets;'), '0');
  sql(fixtures.sql);
  // Refuse a second seed, preserving the first run and its credentials.
  let rejectedDuplicate = false;
  try { sql(fixtures.sql); } catch (error) {
    rejectedDuplicate = String(error.stderr || '').includes('ERROR:  Fixture gate: database must be empty');
  }
  assert.ok(rejectedDuplicate, 'Fixture must refuse nonempty databases');
  assert.equal(sql('SELECT count(*) FROM auth.users;'), '5');
  assert.equal(sql('SELECT count(*) FROM vault.secrets;'), '0');
  stage = 'database security tests';
  const tap = sql(readFileSync('supabase/tests/001_baseline_security.sql', 'utf8'));
  assert.ok(!/^not ok\b/m.test(tap) && /^1\.\.32$/m.test(tap));
  assert.equal((tap.match(/^ok \d+\b/gm) || []).length, 32);
  stage = 'Auth and Storage smoke';
  const probe = `const input = JSON.parse(await new Promise(r => {
    let s=''; process.stdin.on('data', x=>s+=x); process.stdin.on('end',()=>r(s));
  })); const assert = (ok) => { if (!ok) throw new Error('Core probe failed'); };
  const health = await fetch('http://auth:9999/health'); assert(health.status === 200);
  const login = await fetch('http://auth:9999/token?grant_type=password', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({email:'admin@barber.test',password:input.password})
  }); assert(login.status === 200); const session = await login.json();
  assert(session.user.app_metadata.role === 'admin' && !!session.access_token);
  const headers = {Authorization:'Bearer '+input.key,'Content-Type':'application/json'};
  const invite = await fetch('http://auth:9999/invite', {method:'POST',headers,
    body:JSON.stringify({email:'invite-probe@barber.test'})}); assert(invite.status === 200);
  const inbox = await (await fetch('http://mailpit:8025/api/v1/messages')).json();
  assert(inbox.total === 1);
  const bucket = await fetch('http://storage:5000/bucket', {method:'POST', headers,
    body:JSON.stringify({id:'synthetic-probe',name:'synthetic-probe',public:false})});
  assert(bucket.status === 200);
  const object = await fetch('http://storage:5000/object/synthetic-probe/check.txt', {
    method:'POST',headers:{Authorization:headers.Authorization,'Content-Type':'text/plain'},body:'synthetic-only'});
  assert(object.status === 200);
  const download = await fetch('http://storage:5000/object/authenticated/synthetic-probe/check.txt', {headers});
  assert(download.status === 200 && await download.text() === 'synthetic-only');
  const denied = await fetch('http://storage:5000/object/authenticated/synthetic-probe/check.txt', {
    headers:{Authorization:'Bearer '+input.anon}});
  const denial = await denied.json();
  assert((${isPrivateStorageDenied.toString()})(denied.status, denial));
  console.log('PASS: synthetic Auth login/invite to mail sink, private Storage upload/download and anonymous denial');`;
  console.log(docker(['exec', '-i', `${project}-storage`, 'node', '--input-type=module', '-e', probe],
    { input: JSON.stringify({ key: variables.SERVICE_ROLE_KEY, anon: variables.ANON_KEY,
      password: fixtures.accounts.find((account) => account.email === 'admin@barber.test').password }) }).trim());
  console.log('PASS: patched Postgres + Auth/REST/Storage core, four migration replay, random staging fixtures, duplicate-seed refusal, 32 pgTAP checks.');
  stage = 'local recovery rehearsal';
  await rehearseCoreRecovery({ model, upstream, docker, compose, accounts: fixtures.accounts,
    key: variables.SERVICE_ROLE_KEY, anon: variables.ANON_KEY });
  console.log('Not full-stack, VPS, public routing or release acceptance.');
} catch (error) {
  console.error(`Core compatibility probe FAILED at ${stage}; no deployment acceptance.`);
  if (stage === 'local recovery rehearsal' && /^Local synthetic recovery rehearsal failed at [a-zA-Z, /-]+$/.test(error.message)) console.error(error.message);
  if (stage.startsWith('isolation inspection')) {
    console.error(error instanceof assert.AssertionError ? error.message.split('\n')[0] : 'Inspection command failed');
  }
  if (stage === 'isolated core startup' || stage.startsWith('image pull') || stage.startsWith('image metadata')) {
    // Compose diagnostics only; never dump service logs or rendered configuration.
    let diagnostic = String(error.stderr || '').split('\n').slice(-12).join('\n');
    for (const secret of redactions) diagnostic = diagnostic.replaceAll(secret, '[REDACTED]');
    diagnostic = diagnostic.replace(/\b[a-z]+:\/\/[^\s]+/gi, '[REDACTED URL]')
      .replace(/[A-Za-z0-9_+\/=.-]{48,}/g, '[REDACTED LONG VALUE]');
    console.error(diagnostic);
  }
  process.exitCode = 1;
} finally {
  if (started) {
    try {
      for (const name of Object.keys(model.services)) {
        const matches = docker(['ps', '-aq', '--filter', `name=^/${project}-${name}$`]).trim();
        if (matches) assert.equal(JSON.parse(docker(['inspect', matches]))[0].Config.Labels[label], project);
      }
      for (const volume of Object.values(model.volumes)) {
        const matches = docker(['volume', 'ls', '-q', '--filter', `name=^${volume.name}$`]).trim();
        if (matches) assert.equal(JSON.parse(docker(['volume', 'inspect', matches]))[0].Labels[label], project);
      }
      const network = docker(['network', 'ls', '-q', '--filter', `name=^${project}$`]).trim();
      if (network) assert.equal(JSON.parse(docker(['network', 'inspect', network]))[0].Labels[label], project);
      compose(['down', '--volumes', '--timeout', '10'], { timeout: 60000 });
      console.log('Removed only this probe’s containers, network and synthetic data volumes.');
    } catch {
      console.error(`Cleanup requires attention for ${project}; no broad cleanup attempted.`);
      process.exitCode = 1;
    }
  }
}
