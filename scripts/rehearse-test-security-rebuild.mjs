// Native AMD64 synthetic rebuild: no live DB reads, dumps, reset or data restore.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync, rmdirSync, unlinkSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { readProtected } from './staging-live-context.mjs';
import { observedTestRuntime } from './test-environment-runtime.mjs';
import { INSTALL_ROOT } from './staging-private-model.mjs';
import { syntheticRebuildModel } from './test-synthetic-model.mjs';
import { checksum } from './staging-private-backup-format.mjs';
import { prepareStagingFixtures } from './staging-fixtures.mjs';
import { writePublicContainerSource } from './write-public-container-source.mjs';
import { fullStackClient } from './staging-full-stack-client.mjs';
import { isPrivateStorageDenied } from './rehearse-staging-core-recovery.mjs';
import { OPERATION_LOCK } from './test-environment-state.mjs';
import { waitForTestWebsocket } from './test-realtime-readiness.mjs';

const project = `barber-test-rebuild-${randomBytes(8).toString('hex')}`;
const label = 'cloud.malabdullah.barber.synthetic-rebuild';
let stage = 'preflight'; let scratch; let model; let docker; let compose; let created = false; let completed; const locked = false;
try {
  assert.equal(process.platform, 'linux'); assert.equal(process.arch, 'x64'); assert.equal(process.getuid(), 0); assert.equal(hostname(), 'srv1207055'); assert.equal(process.argv.length, 2);
  const context = observedTestRuntime({ includePrivate: true }); docker = context.docker;
  assert.equal(context.candidate.commit, '7ddcfe45b6d69da58425ed4ad1e0ddcc635303f9');
  const freezeBefore = readFileSync('/opt/barber-staging-test-operations/state.json');
  const functionCandidate = JSON.parse(readFileSync('functions-candidate.json'));
  assert.match(functionCandidate.image, /^sha256:[a-f0-9]{64}$/);
  assert.match(functionCandidate.sourceCommit, /^[a-f0-9]{40}$/);
  assert.equal(docker(['info', '--format', '{{.Architecture}}']), 'x86_64');
  const before = docker(['ps', '--format', '{{.ID}} {{.Names}} {{.Image}}']).split('\n').filter(Boolean).sort();
  assert.equal(existsSync(OPERATION_LOCK), false);
  scratch = mkdtempSync(join(tmpdir(), 'barber-test-rebuild-'));
  const synthetic = syntheticRebuildModel(context.backend, context.frontend, project, scratch); model = synthetic.model;
  model.services.functions.image = functionCandidate.image;
  const availableKiB = Number(readFileSync('/proc/meminfo', 'utf8').match(/^MemAvailable:\s+(\d+) kB$/m)?.[1]);
  assert.ok(availableKiB * 1024 >= synthetic.maximumMemoryBytes + 1536 * 1048576, 'Insufficient memory headroom');
  const { statfsSync } = await import('node:fs'); const capacity = statfsSync('/var/backups/barber-staging');
  assert.ok(capacity.bavail * capacity.bsize >= 8 * 1024 ** 3, 'Insufficient disk headroom');
  for (const dir of ['sql', 'gateway']) mkdirSync(join(scratch, dir), { mode: 0o700 });
  for (const [file, hash] of Object.entries(context.prepared.publicFiles)) {
    assert.match(file, /^(sql|gateway)\/[a-z_.-]+$/);
    const bytes = readProtected(`${INSTALL_ROOT}/${file}`); assert.equal(checksum(bytes), hash);
    writePublicContainerSource(join(scratch, file), bytes);
  }
  const runtime = readProtected('/opt/barber-staging/manual-first-release/runtime-config.same-origin.js').toString();
  writePublicContainerSource(join(scratch, 'runtime-config.same-origin.js'), runtime.replace(context.backend.services.functions.environment.SUPABASE_ANON_KEY, synthetic.settings.variables.ANON_KEY));
  writePublicContainerSource(join(scratch, 'nginx.same-origin.conf'), readProtected('/opt/barber-staging/manual-first-release/nginx.same-origin.conf'));
  for (const service of Object.values(model.services)) {
    assert.equal(docker(['ps', '-aq', '--filter', `name=^/${service.container_name}$`]), '');
    const [image] = JSON.parse(docker(['image', 'inspect', service.image])); assert.equal(image.Os, 'linux'); assert.equal(image.Architecture, 'amd64');
  }
  for (const volume of Object.values(model.volumes)) assert.equal(docker(['volume', 'ls', '-q', '--filter', `name=^${volume.name}$`]), '');
  assert.equal(docker(['network', 'ls', '-q', '--filter', `name=^${project}$`]), '');
  // This separate labelled lab never resets or changes the frozen shared stack.
  // No freeze/operation-state rewrite is authorized; preflight rejects an active operation.
  compose = (args, options = {}) => docker(['compose', '--project-directory', scratch, '-p', project, '-f', '-', ...args], { input: JSON.stringify(model), timeout: 300000, ...options });
  const sql = input => docker(['exec', '-i', '-u', 'postgres', `${project}-db`, 'psql', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-d', 'postgres'], { input });
  stage = 'empty database initialization'; created = true;
  // Auth and Storage own their schemas; start their migrations before probing
  // an empty application database, matching the existing core rehearsal.
  compose(['up', '-d', '--wait', '--wait-timeout', '240', 'db', 'auth', 'rest', 'storage', 'mailpit']);
  assert.equal(sql('SHOW cron.launch_active_jobs;'), 'off');
  assert.equal(sql("SELECT (SELECT count(*) FROM auth.users)+(SELECT count(*) FROM vault.secrets)+(SELECT count(*) FROM storage.objects)+(SELECT count(*) FROM storage.buckets);"), '0');
  const files = readdirSync('supabase/migrations').filter(f => f.endsWith('.sql')).sort();
  const approvedMigrations = Object.fromEntries(context.candidate.migrations.map(m => [m.file, m.sha256]));
  const extraFile = '20261012045130_harden_legacy_function_paths_and_rate_limits.sql';
  const sourceManifest = JSON.parse(readFileSync('source-manifest.json'));
  approvedMigrations[extraFile] = sourceManifest.files['supabase/migrations/' + extraFile];
  assert.match(approvedMigrations[extraFile], /^[a-f0-9]{64}$/);
  assert.deepEqual(files, Object.keys(approvedMigrations).sort());
  const migrations = [];
  sql('CREATE SCHEMA IF NOT EXISTS supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY, statements text[], name text);');
  stage = 'committed migration replay';
  for (const file of files) {
    assert.match(file, /^\d{14}_[a-z0-9_]+\.sql$/); const data = readFileSync(`supabase/migrations/${file}`);
    assert.equal(checksum(data), approvedMigrations[file]); migrations.push({ file, sha256: checksum(data) });
    sql(`BEGIN;\n${data}\nINSERT INTO supabase_migrations.schema_migrations(version,name) VALUES ('${file.slice(0, 14)}','${file.slice(15, -4)}');\nCOMMIT;`);
  }
  stage = 'fresh synthetic fixtures';
  const fixtures = prepareStagingFixtures(); sql(fixtures.sql); assert.equal(sql('SELECT count(*) FROM auth.users;'), '5');
  for (const [file, count] of [['001_baseline_security.sql',32], ['002_booking_reminder_writes.sql',35], ['003_legacy_function_hardening.sql',27]]) {
    const tap = sql(readFileSync('supabase/tests/' + file, 'utf8'));
    writeFileSync(project + '-' + file + '.tap', tap, {flag:'wx',mode:0o600});
    assert.ok(!/^not ok\b/m.test(tap)); assert.equal((tap.match(/^ok \d+\b/gm)||[]).length,count);
  }
  const labIp = JSON.parse(docker(['inspect', project + '-db']))[0].NetworkSettings.Networks[project].IPAddress;
  const cli = '/opt/barber-staging-closure-preparation/booking-reminders-tools/supabase';
  const cliEnv = {...process.env, PGPASSWORD:synthetic.settings.variables.POSTGRES_PASSWORD, SUPABASE_DB_PASSWORD:synthetic.settings.variables.POSTGRES_PASSWORD};
  const dbUrl = 'postgresql://supabase_admin@' + labIp + ':5432/postgres?sslmode=disable';
  stage = 'read-only security advisors';
  let advisors;
  try {
    advisors = execFileSync(cli,['db','advisors','--db-url',dbUrl,'--type','security','--level','warn','--fail-on','none','--output','json','--agent','no'],{env:cliEnv,encoding:'utf8',timeout:60000,stdio:['ignore','pipe','pipe']});
  } catch (error) {
    const privateDiagnostic = { stage, name:error.name, status:error.status, signal:error.signal,
      stderr:String(error.stderr||'').replaceAll(synthetic.settings.variables.POSTGRES_PASSWORD,'[synthetic-redacted]') };
    writeFileSync(project+'-advisor-failure.json',JSON.stringify(privateDiagnostic),{flag:'wx',mode:0o600});
    console.error(JSON.stringify({stage,name:error.name,status:error.status,signal:error.signal,privateDiagnosticRecorded:true}));
    throw error;
  }
  writeFileSync(project + '-advisors.json',advisors,{flag:'wx',mode:0o600});
  assert.ok(!advisors.includes('function_search_path_mutable'));
  stage = 'public schema export';
  // The remote Docker dump wrapper does not preserve this direct-DB password
  // environment reliably. Keep credentials out of argv: dump through the fresh
  // container's socket, then use the exact pinned official CLI formatter.
  const dryRun = execFileSync(cli,['db','dump','--dry-run','--db-url',
    'postgresql://postgres:synthetic-placeholder@127.0.0.1:1/postgres?sslmode=disable',
    '--schema','public','--agent','no'],{encoding:'utf8',timeout:30000,stdio:['ignore','pipe','pipe']});
  const transformations = dryRun.split('\n').filter(line=>line.startsWith('| sed -E '));
  assert.equal(transformations.length,26);
  const formatter = transformations.map((line,index)=>index===0?line.slice(2):line).join('\n');
  assert.equal(checksum(Buffer.from(formatter)),'5c57d52befa24b51df6588fe14f0198481712d1d9ff43a1dc1120133172ae772');
  const rawSchema = docker(['exec','-u','postgres',project+'-db','pg_dump','-U','supabase_admin',
    '--role','postgres','--schema-only','--quote-all-identifiers','--exclude-schema','',
    '--schema=public','--dbname=postgres'],{encoding:null});
  const schema = execFileSync('/usr/bin/bash',['-c','set -euo pipefail\n'+formatter],
    {input:rawSchema,encoding:'utf8',timeout:30000,stdio:['pipe','pipe','pipe']});
  writeFileSync(project+'-public-schema.sql',schema,{flag:'wx',mode:0o600});
  const probe = randomBytes(24).toString('hex');
  sql(`SELECT vault.create_secret('${probe}', 'synthetic_rebuild_probe');`);
  assert.equal(sql("SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='synthetic_rebuild_probe';"), probe);
  stage = 'nine disposable services'; compose(['up', '-d', '--no-recreate', '--wait', '--wait-timeout', '240']);
  for (const service of Object.values(model.services)) {
    const [state] = JSON.parse(docker(['inspect', service.container_name])); assert.equal(state.Config.Labels[label], project);
    assert.equal(state.State.Running, true); assert.deepEqual(Object.keys(state.HostConfig.PortBindings || {}), []);
    assert.deepEqual(Object.keys(state.NetworkSettings.Networks), [project]);
    assert.ok(state.Mounts.filter(m => m.Type === 'volume').every(m => Object.values(model.volumes).some(v => v.name === m.Name)));
  }
  assert.equal(JSON.parse(docker(['network', 'inspect', project]))[0].Internal, true);
  const core = async input => {
    const ok = value => { if (!value) throw new Error('SYNTHETIC_REBUILD_CORE_FAILED'); };
    const headers = { Authorization: 'Bearer ' + input.key, 'Content-Type': 'application/json' };
    for (const account of input.accounts) {
      const response = await fetch('http://auth:9999/token?grant_type=password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(account) });
      ok(response.status === 200 && Boolean((await response.json()).access_token));
    }
    ok((await fetch('http://storage:5000/bucket', { method: 'POST', headers, body: JSON.stringify({ id: 'synthetic-probe', name: 'synthetic-probe', public: false }) })).status === 200);
    ok((await fetch('http://storage:5000/object/synthetic-probe/check.txt', { method: 'POST', headers: { Authorization: headers.Authorization, 'Content-Type': 'text/plain' }, body: 'synthetic-only' })).status === 200);
    ok((await fetch('http://auth:9999/invite', { method: 'POST', headers, body: JSON.stringify({ email: 'rebuild-probe@barber.test' }) })).status === 200);
    ok((await (await fetch('http://mailpit:8025/api/v1/messages')).json()).total === 1);
    const response = await fetch('http://frontend:8080/runtime-config.js'); ok(response.status === 200 && response.headers.get('x-robots-tag') === 'noindex, nofollow');
    ok((await response.text()).includes(input.anon)); console.log('PASS: five synthetic logins, new private Storage bytes, sink email and frontend runtime');
  };
  const manifestTar = docker(['cp', project + '-functions:/home/deno/bundle-manifest.json', '-'], {encoding:null});
  const bundleManifest = JSON.parse(execFileSync('/usr/bin/tar',['-xOf','-','bundle-manifest.json'],{input:manifestTar,encoding:'utf8'}));
  assert.equal(bundleManifest.sourceCommit,functionCandidate.sourceCommit); assert.equal(bundleManifest.treeSha256,functionCandidate.bundleTreeSha256);
  stage = 'Auth Storage sink and frontend';
  console.log(docker(['exec', '-i', `${project}-storage`, 'node', '--input-type=module'], { input: `await (${core.toString()})(${JSON.stringify({ key: synthetic.settings.variables.SERVICE_ROLE_KEY, anon: synthetic.settings.variables.ANON_KEY, accounts: fixtures.accounts })});` }));
  sql("CREATE POLICY full_stack_probe_read ON realtime.messages FOR SELECT TO authenticated USING ((select auth.uid())='00000000-0000-4000-8000-000000000001'::uuid AND realtime.topic()='probe-allowed'); CREATE POLICY full_stack_probe_write ON realtime.messages FOR INSERT TO authenticated WITH CHECK ((select auth.uid())='00000000-0000-4000-8000-000000000001'::uuid AND realtime.topic()='probe-allowed');");
  const settings = { requireRateLimiterFailClosed:true, anon: synthetic.settings.variables.ANON_KEY, key: synthetic.settings.variables.SERVICE_ROLE_KEY, meta: synthetic.settings.meta, verify: synthetic.settings.verify, cron: synthetic.settings.cron,
    flowPublic: synthetic.settings.flowPublic, password: fixtures.accounts[0].password, barberPassword: fixtures.accounts.find(a => a.email === 'barber@barber.test').password,
    otherManagerPassword: fixtures.accounts.find(a => a.email === 'manager-two@barber.test').password };
  stage = 'Functions and Realtime isolation';
  docker(['exec', '-i', `${project}-storage`, 'node', '--input-type=module'], { input: `await (${waitForTestWebsocket.toString()})(${JSON.stringify(settings.anon)});`, timeout: 150000 });
  console.log(docker(['exec', '-i', `${project}-storage`, 'node', '--input-type=module'], { input: `await (${fullStackClient.toString()})(${JSON.stringify(settings)}, (${isPrivateStorageDenied.toString()}));`, timeout: 180000 }));
  const after = docker(['ps', '--format', '{{.ID}} {{.Names}} {{.Image}}']).split('\n').filter(line => line && !line.split(' ')[1].startsWith(`${project}-`)).sort();
  assert.deepEqual(after, before); assert.equal(observedTestRuntime().candidateIdentity,context.candidateIdentity);
  assert.deepEqual(readFileSync('/opt/barber-staging-test-operations/state.json'),freezeBefore);
  completed = { kind: 'barber-test-security-synthetic-rebuild/v1', at: new Date().toISOString(), project, host: 'srv1207055', images: Object.fromEntries(Object.entries(model.services).map(([k, s]) => [k, s.image])), migrations,
    checks: ['five synthetic logins', '94 pgTAP checks and no mutable-search-path findings', 'new Vault encryption', 'Storage bytes and anonymous denial', 'sink-only SMTP', 'frontend runtime', 'gateway and Functions boundaries', 'encrypted Flow', 'Realtime delivery and tenant denial'],
    functionCandidate, schemaDump:project+'-public-schema.sql', advisors:project+'-advisors.json', liveFreezeUnchanged:true, freshCredentials: true, freshVolumes: true, liveDatabaseRead: false, liveVolumesOverwritten: false, originalServicesUnchanged: true, lostServerRestoreVerified: false };
} catch (error) {
  console.error(`Synthetic Test rebuild failed at ${stage}; no successful rebuild claimed.`);
  const stderr = String(error?.stderr || '');
  for (const reason of ['password authentication failed', 'connection refused', 'does not exist', 'permission denied', 'out of memory']) {
    if (stderr.toLowerCase().includes(reason)) console.error(`Sanitized failure category: ${reason}`);
  }
  const detail = String(error?.stderr || '').match(/FULLSTACK_ASSERT:[a-zA-Z0-9 _:/.-]+/)?.[0]; if (detail) console.error(detail);
  for (const line of String(error?.stdout || '').split('\n')) if (/^FULLSTACK_PASS: [a-zA-Z ]+$/.test(line)) console.log(line);
  if (created && docker && model) {
    for (const [name, service] of Object.entries(model.services)) try {
      const [state] = JSON.parse(docker(['inspect', service.container_name]));
      if (state.Config.Labels[label] === project) console.error(JSON.stringify({ service: name, running: state.State.Running, health: state.State.Health?.Status || null, exitCode: state.State.ExitCode, oom: state.State.OOMKilled }));
    } catch { /* Not created yet. */ }
    if (stage === 'Functions and Realtime isolation') try {
      const diagnostic = async input => {
        const { request } = await import('node:http');
        const { randomBytes } = await import('node:crypto');
        for (const [host, path] of [['api-gw:8000', '/realtime/v1/websocket'], ['realtime:4000', '/socket/websocket']]) {
          const status = await new Promise(resolve => {
            const req = request(`http://${host}${path}?apikey=${input.anon}&vsn=1.0.0`, { headers: { Host: 'realtime-dev.supabase-realtime', Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': randomBytes(16).toString('base64') } });
            req.on('upgrade', (response, socket) => { socket.destroy(); resolve(response.statusCode); });
            req.on('response', response => { response.resume(); resolve(response.statusCode); });
            req.on('error', () => resolve('transport-error')); req.setTimeout(10000, () => { req.destroy(); resolve('timeout'); }); req.end();
          });
          console.log(JSON.stringify({ check: host.startsWith('api-gw') ? 'gateway-websocket-upgrade' : 'direct-websocket-upgrade', status }));
        }
      };
      console.error(docker(['exec', '-i', `${project}-storage`, 'node', '--input-type=module'], { input: `await (${diagnostic.toString()})(${JSON.stringify({ anon: model.services.functions.environment.SUPABASE_ANON_KEY })});`, timeout: 30000 }));
      const logs = docker(['logs', '--tail', '100', `${project}-realtime`]);
      for (const code of ['TenantNotFound', 'InvalidJWTToken', 'SignatureError', 'Connection refused', 'too many clients', 'not enough privileges']) if (logs.includes(code)) console.error(`Realtime diagnostic category: ${code}`);
    } catch { console.error('Bounded disposable protocol diagnostic unavailable.'); }
  }
  const location = String(error?.stack || '').match(/(?:rehearse-test-synthetic|test-synthetic-model|staging-[a-z-]+)\.mjs:\d+:\d+/)?.[0]; if (location) console.error(`Sanitized check location: ${location}`);
  process.exitCode = 1;
} finally {
  let cleaned = !created;
  if (created && docker && model && compose) try {
    for (const service of Object.values(model.services)) {
      const ids = docker(['ps', '-aq', '--filter', `name=^/${service.container_name}$`]);
      if (ids) assert.equal(JSON.parse(docker(['inspect', ids]))[0].Config.Labels[label], project);
    }
    for (const volume of Object.values(model.volumes)) {
      const ids = docker(['volume', 'ls', '-q', '--filter', `name=^${volume.name}$`]);
      if (ids) assert.equal(JSON.parse(docker(['volume', 'inspect', volume.name]))[0].Labels[label], project);
    }
    const networks = docker(['network', 'ls', '-q', '--filter', `name=^${project}$`]);
    if (networks) assert.equal(JSON.parse(docker(['network', 'inspect', project]))[0].Labels[label], project);
    compose(['down', '--volumes', '--timeout', '10']); cleaned = true;
    console.log('Removed only labelled rebuild containers, network and fresh synthetic volumes.');
  } catch { console.error(`Scoped cleanup needs investigation: ${project}`); process.exitCode = 1; }
  if (scratch && cleaned) rmSync(scratch, { recursive: true });
  if (locked && cleaned && completed) { unlinkSync(`${OPERATION_LOCK}/journal.json`); rmdirSync(OPERATION_LOCK); }
  if (completed && cleaned) {
    const evidence = `/opt/barber-staging-closure-preparation/${project}.json`;
    writeFileSync(evidence, JSON.stringify({ ...completed, temporaryResourcesCleaned: true }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ project, status: 'synthetic-rebuild-verified', evidence, lostServerRestoreVerified: false }));
  }
}
