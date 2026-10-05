// One-time operator bootstrap only. No public ingress, release broker or reset.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { hostname } from 'node:os';
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync, unlinkSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { localDockerProbe } from './local-docker-probe.mjs';
import { inspectCandidate, inspectPlatformImage } from './staging-postgres-candidate.mjs';
import { validateCoreCandidateMetadata } from './staging-core-candidates.mjs';
import { validateFullStackMetadata } from './staging-full-stack-probe.mjs';
import { minimalStagingEnvoy } from './staging-envoy-minimal.mjs';
import { writePublicContainerSource } from './write-public-container-source.mjs';
import { prepareStagingFixtures } from './staging-fixtures.mjs';
import { APPROVED_SOURCE, INSTALL_ROOT, PROJECT, OWNER_LABEL, SERVICES, IMAGES,
  privateVariables, buildPrivateModel, validatePrivateModel } from './staging-private-model.mjs';

const hash = (data) => createHash('sha256').update(data).digest('hex');
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
const save = (path, data) => writeFileSync(path, JSON.stringify(data, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
let stage = 'operator preflight';
let model;
let docker;
let started = false;
let source;
const receipt = {};
try {
  assert.equal(process.platform, 'linux');
  assert.equal(process.arch, 'x64');
  assert.equal(process.getuid(), 0);
  assert.equal(hostname(), 'srv1207055');
  assert.ok(['prepare', 'initialize'].includes(process.argv[2]) && process.argv.length === 4);
  source = realpathSync(process.argv[3]);
  process.chdir(source);
  assert.equal(readFileSync('APPROVED_SOURCE', 'utf8').trim(), APPROVED_SOURCE);
  assert.equal(readFileSync('OWNER_APPROVAL', 'utf8').trim(), 'Approve this private staging bootstrap');
  assert.ok(Date.now() < Date.parse('2026-10-18T00:00:00Z'), 'Realtime acceptance expired');
  // The source archive manifest is made from the owner-approved Git commit.
  const sourceManifest = json('approved-source-manifest.json');
  assert.equal(sourceManifest.commit, APPROVED_SOURCE);
  for (const [file, digest] of Object.entries(sourceManifest.files)) {
    assert.ok(!file.includes('..') && !file.startsWith('/'));
    assert.equal(hash(readFileSync(file)), digest, 'Approved source changed');
  }
  assert.ok(readFileSync('supabase/.baseline-ready', 'utf8').includes('verified'));
  docker = localDockerProbe();
  assert.equal(docker(['info', '--format', '{{.Architecture}}']), 'x86_64');
  const compose = (args, options = {}) => docker(['compose', '--project-directory', INSTALL_ROOT,
    '-p', PROJECT, '-f', '-', ...args], { input: JSON.stringify(model), ...options });
  const sql = (input) => docker(['exec', '-i', '-u', 'postgres', `${PROJECT}-db`,
    'psql', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-d', 'postgres'], { input }).trim();
  const assertAbsentResources = () => {
    for (const name of SERVICES) assert.equal(docker(['ps', '-aq', '--filter', `name=^/${PROJECT}-${name}$`]), '');
    assert.equal(docker(['network', 'ls', '-q', '--filter', `name=^${PROJECT}$`]), '');
    for (const suffix of ['data', 'config', 'storage']) assert.equal(docker(['volume', 'ls', '-q', '--filter', `name=^${PROJECT}-${suffix}$`]), '');
  };
  stage = 'exact image verification';
  inspectCandidate(docker, IMAGES.db, 'linux/amd64');
  for (const name of SERVICES.filter((name) => name !== 'db')) {
    const metadata = inspectPlatformImage(docker, IMAGES[name], 'linux/amd64');
    if (['auth', 'storage', 'rest'].includes(name)) validateCoreCandidateMetadata(name, IMAGES[name], metadata, 'linux/amd64');
    else if (['functions', 'realtime'].includes(name)) validateFullStackMetadata(name, metadata);
    else assert.ok(metadata.RepoDigests.includes(IMAGES[name]));
  }
  if (process.argv[2] === 'prepare') {
    stage = 'fresh resource gate';
    assert.ok(!existsSync(INSTALL_ROOT));
    const parent = lstatSync(existsSync('/opt/barber-staging') ? '/opt/barber-staging' : '/opt');
    assert.ok(parent.isDirectory() && !parent.isSymbolicLink() && parent.uid === 0 && (parent.mode & 0o022) === 0);
    assertAbsentResources();
    const upstream = realpathSync('upstream');
    assert.equal(readFileSync(`${upstream}/.supabase-version`, 'utf8').trim(),
      'ref=241bb11c0627f2981746d37033f57dbfa81d29b0');
    const settings = privateVariables(parseEnv(readFileSync(`${upstream}/.env.example`, 'utf8')));
    const temporaryEnv = `${source}/bootstrap-render.env`;
    let rendered;
    try {
      writeFileSync(temporaryEnv, Object.entries(settings.variables).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n'), { flag: 'wx', mode: 0o600 });
      rendered = JSON.parse(docker(['compose', '--project-directory', INSTALL_ROOT, '--env-file', temporaryEnv,
        '-f', `${upstream}/docker-compose.yml`, '-f', `${source}/ops/staging-vps/compose.override.yml`, 'config', '--format', 'json']));
    } finally { if (existsSync(temporaryEnv)) unlinkSync(temporaryEnv); }
    const profilePath = 'ops/staging-vps/realtime-security/runtime-profile.yml';
    assert.equal(hash(readFileSync(profilePath)), 'a991dccc40ca64c42d03cbf7b0ecf9d17b1174eb585a73934367f6f407cb3c9a');
    const profile = JSON.parse(docker(['compose', '-p', PROJECT, '-f', '-', '-f', profilePath, 'config', '--format', 'json'],
      { input: JSON.stringify({ services: { realtime: { image: IMAGES.realtime } } }) })).services.realtime;
    model = buildPrivateModel(rendered, settings, profile);
    const gatewayRoot = `${upstream}/volumes/api/envoy`;
    const gateway = minimalStagingEnvoy(readFileSync(`${gatewayRoot}/lds.template.yaml`, 'utf8'), readFileSync(`${gatewayRoot}/cds.yaml`, 'utf8'));
    const publicFiles = {};
    for (const [name, digest] of Object.entries({ 'docker-entrypoint.sh': '7ae0abaa8d76332d001e60dc29d4f29985890f89e04ee78489abbf680495631d',
      'envoy.yaml': '3697f23b0be9ec5b829f937c600eb9b878f1f778ab510b42ad5e4f14742447e9' })) {
      publicFiles[`gateway/${name}`] = readFileSync(`${gatewayRoot}/${name}`);
      assert.equal(hash(publicFiles[`gateway/${name}`]), digest);
    }
    publicFiles['gateway/lds.template.yaml'] = gateway.listener;
    publicFiles['gateway/cds.yaml'] = gateway.clusters;
    for (const mount of model.services.db.volumes.filter((mount) => mount.type === 'bind')) {
      const name = mount.source.split('/').at(-1);
      publicFiles[`sql/${name}`] = readFileSync(`${upstream}/volumes/db/${name}`);
    }
    const fixtures = prepareStagingFixtures();
    const migrations = readdirSync('supabase/migrations').filter((file) => file.endsWith('.sql')).sort();
    assert.equal(migrations.length, 4);
    assert.ok(migrations.every((file) => /^\d{14}_[a-z0-9_]+\.sql$/.test(file)));
    stage = 'private configuration creation';
    if (!existsSync('/opt/barber-staging')) mkdirSync('/opt/barber-staging', { mode: 0o700 });
    mkdirSync(INSTALL_ROOT, { mode: 0o700 });
    for (const dir of ['sql', 'gateway', 'migrations']) mkdirSync(`${INSTALL_ROOT}/${dir}`, { mode: 0o700 });
    for (const [path, data] of Object.entries(publicFiles)) writePublicContainerSource(`${INSTALL_ROOT}/${path}`, data);
    for (const file of migrations) cpSync(`supabase/migrations/${file}`, `${INSTALL_ROOT}/migrations/${file}`, { errorOnExist: true, force: false });
    save(`${INSTALL_ROOT}/compose.private.json`, model);
    save(`${INSTALL_ROOT}/synthetic-accounts.json`, fixtures.accounts);
    save(`${INSTALL_ROOT}/synthetic-integration.json`, { meta: settings.meta, verify: settings.verify, cron: settings.cron, flowPublic: settings.flowPublic });
    writeFileSync(`${INSTALL_ROOT}/seed.private.sql`, fixtures.sql, { flag: 'wx', mode: 0o600 });
    cpSync('supabase/tests/001_baseline_security.sql', `${INSTALL_ROOT}/security-tests.sql`, { errorOnExist: true, force: false });
    Object.assign(receipt, { kind: 'private-staging-bootstrap-prepared', approvedSource: APPROVED_SOURCE,
      ownerApproval: 'Approve this private staging bootstrap', host: hostname(), project: PROJECT,
      createdAt: new Date().toISOString(), keyExpiresAt: settings.keyExpiresAt, images: IMAGES,
      composeSha256: hash(readFileSync(`${INSTALL_ROOT}/compose.private.json`)),
      seedSha256: hash(readFileSync(`${INSTALL_ROOT}/seed.private.sql`)),
      migrations: Object.fromEntries(migrations.map((file) => [file, hash(readFileSync(`supabase/migrations/${file}`))])),
      publicFiles: Object.fromEntries(Object.entries(publicFiles).map(([path, data]) => [path, hash(data)])) });
    save(`${INSTALL_ROOT}/prepared.json`, receipt);
    console.log('PREPARED: new private configuration only; no containers started and no ports published.');
  } else {
    stage = 'prepared configuration validation';
    for (const path of [INSTALL_ROOT, `${INSTALL_ROOT}/compose.private.json`, `${INSTALL_ROOT}/seed.private.sql`, `${INSTALL_ROOT}/prepared.json`]) {
      const stat = lstatSync(path);
      assert.ok(!stat.isSymbolicLink() && stat.uid === 0 && (stat.mode & 0o077) === 0);
    }
    assert.ok(!existsSync(`${INSTALL_ROOT}/initialization-started.json`), 'Initialization may run once only');
    const prepared = json(`${INSTALL_ROOT}/prepared.json`);
    assert.equal(prepared.approvedSource, APPROVED_SOURCE);
    assert.equal(hash(readFileSync(`${INSTALL_ROOT}/compose.private.json`)), prepared.composeSha256);
    assert.equal(hash(readFileSync(`${INSTALL_ROOT}/seed.private.sql`)), prepared.seedSha256);
    for (const [file, digest] of Object.entries(prepared.publicFiles)) assert.equal(hash(readFileSync(`${INSTALL_ROOT}/${file}`)), digest);
    for (const [file, digest] of Object.entries(prepared.migrations)) assert.equal(hash(readFileSync(`${INSTALL_ROOT}/migrations/${file}`)), digest);
    model = json(`${INSTALL_ROOT}/compose.private.json`);
    validatePrivateModel(model);
    assertAbsentResources();
    assert.ok(existsSync(`${INSTALL_ROOT}/pre-initialization-config.tar.age`), 'Encrypted configuration recovery copy required');
    const existing = docker(['ps', '--format', '{{.ID}} {{.Names}} {{.Image}}']).split('\n').filter(Boolean).sort();
    save(`${INSTALL_ROOT}/initialization-started.json`, { at: new Date().toISOString(), source: APPROVED_SOURCE, existing,
      operatorSha256: hash(readFileSync('scripts/run-private-staging-bootstrap.mjs')),
      modelBuilderSha256: hash(readFileSync('scripts/staging-private-model.mjs')) });
    stage = 'private core startup'; started = true;
    compose(['up', '-d', '--wait', '--wait-timeout', '240', ...SERVICES.slice(0, 5)], { timeout: 300000 });
    assert.equal(sql('SHOW cron.launch_active_jobs;'), 'off');
    assert.equal(sql("SELECT count(*) FROM pg_tables WHERE schemaname='public';"), '0');
    assert.equal(sql('SELECT (SELECT count(*) FROM auth.users)+(SELECT count(*) FROM vault.secrets)+(SELECT count(*) FROM storage.objects)+(SELECT count(*) FROM storage.buckets);'), '0');
    assert.equal(sql("SELECT to_regclass('supabase_migrations.schema_migrations') IS NULL;"), 't');
    stage = 'approved baseline replay';
    sql('CREATE SCHEMA IF NOT EXISTS supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, statements text[], name text);');
    for (const file of Object.keys(prepared.migrations)) {
      const version = file.slice(0, 14); const name = file.slice(15, -4);
      sql(`BEGIN;\n${readFileSync(`${INSTALL_ROOT}/migrations/${file}`, 'utf8')}\nINSERT INTO supabase_migrations.schema_migrations(version,name) VALUES ('${version}','${name}');\nCOMMIT;`);
    }
    stage = 'empty-target randomized seed';
    sql(readFileSync(`${INSTALL_ROOT}/seed.private.sql`, 'utf8'));
    assert.equal(sql('SELECT count(*) FROM auth.users;'), '5');
    assert.equal(sql('SELECT count(*) FROM vault.secrets;'), '0');
    stage = 'database security checks';
    const tap = sql(readFileSync(`${INSTALL_ROOT}/security-tests.sql`, 'utf8'));
    assert.ok(!/^not ok\b/m.test(tap) && /^1\.\.32$/m.test(tap));
    assert.equal((tap.match(/^ok \d+\b/gm) || []).length, 32);
    stage = 'eight service startup';
    compose(['up', '-d', '--no-recreate', '--wait', '--wait-timeout', '240'], { timeout: 300000 });
    stage = 'live isolation verification';
    for (const name of SERVICES) {
      const [state] = JSON.parse(docker(['inspect', `${PROJECT}-${name}`]));
      assert.equal(state.Config.Labels[OWNER_LABEL], APPROVED_SOURCE);
      assert.equal(state.State.Running, true);
      assert.deepEqual(Object.keys(state.HostConfig.PortBindings || {}), []);
      assert.deepEqual(Object.keys(state.NetworkSettings.Networks), [PROJECT]);
    }
    assert.equal(JSON.parse(docker(['network', 'inspect', PROJECT]))[0].Internal, true);
    const after = docker(['ps', '--format', '{{.ID}} {{.Names}} {{.Image}}']).split('\n')
      .filter((line) => line && !line.split(' ')[1].startsWith(`${PROJECT}-`)).sort();
    assert.deepEqual(after, existing, 'Existing services changed during bootstrap');
    save(`${INSTALL_ROOT}/initialized.json`, { kind: 'private-staging-initialized', source: APPROVED_SOURCE,
      at: new Date().toISOString(), migrations: prepared.migrations, pgTapAssertions: 32,
      services: SERVICES, publicPorts: false, outboundIntegrations: false, fullAcceptance: false });
    console.log('INITIALIZED: eight private staging services; four migrations, synthetic seed and 32 pgTAP checks passed. Acceptance and backup remain open.');
  }
} catch {
  console.error(`Private bootstrap stopped at: ${stage}. No deployment acceptance.`);
  if (started && model && docker) {
    try {
      for (const service of Object.values(model.services)) {
        const matches = docker(['ps', '-aq', '--filter', `name=^/${service.container_name}$`]);
        if (matches) assert.equal(JSON.parse(docker(['inspect', matches]))[0].Config.Labels[OWNER_LABEL], APPROVED_SOURCE);
      }
      docker(['compose', '--project-directory', INSTALL_ROOT, '-p', PROJECT, '-f', '-', 'stop', '--timeout', '10'],
        { input: JSON.stringify(model), timeout: 60000 });
      console.error('Stopped only new staging services; retained every volume and private configuration. No automatic retry/reset.');
    } catch { console.error('Scoped stop requires operator attention; no broad cleanup attempted.'); }
  }
  process.exitCode = 1;
}
