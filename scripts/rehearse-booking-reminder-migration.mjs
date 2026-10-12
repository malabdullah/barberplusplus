// Owner-approved isolated migration preparation only. Never migrate live Test.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, statfsSync, rmSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { execFileSync } from 'node:child_process';
import { BOOKING_REMINDER_MIGRATION, bookingReminderRoleQuery, validateBookingReminderRole, restoreBookingReminderRoleSql } from './booking-reminder-recovery-role.mjs';
import { observedTestRuntime } from './test-environment-runtime.mjs';
import { syntheticRebuildModel } from './test-synthetic-model.mjs';
import { prepareStagingFixtures } from './staging-fixtures.mjs';
import { readProtected } from './staging-live-context.mjs';
import { checksum } from './staging-private-backup-format.mjs';
import { writePublicContainerSource } from './write-public-container-source.mjs';

const newMigration = '20261011085658_private_booking_reminder_triggers.sql';
const project = 'barber-test-rebuild-' + randomBytes(8).toString('hex');
const label = 'cloud.malabdullah.barber.synthetic-rebuild';
let stage = 'preflight'; let scratch; let docker; let model; let started = false; let result;
const sourceRoot = process.cwd();
try {
  assert.equal(hostname(), 'srv1207055'); assert.equal(process.arch, 'x64'); assert.equal(process.getuid(), 0);
  assert.equal(process.argv.length, 2);
  // Configuration, identity and health observation only; no data export or live
  // write. A frozen live release remains frozen throughout this separate lab.
  const live = observedTestRuntime({ includePrivate: true }); docker = live.docker;
  assert.equal(live.candidate.commit, 'b04eacdfd49ce7aa8c7d1a4217c9fe4394078294');
  assert.ok(live.originMatch && live.syntheticOnly && live.states.length === 9);
  const before = docker(['ps', '-a', '--format', '{{.ID}} {{.Names}} {{.Image}}']).split('\n').filter(Boolean).sort();
  const freezeBefore = readFileSync('/opt/barber-staging-test-operations/state.json');
  assert.equal(existsSync('/var/backups/barber-staging/capture-in-progress'), false);
  scratch = mkdtempSync('/tmp/barber-test-rebuild-');
  const generated = syntheticRebuildModel(live.backend, live.frontend, project, scratch);
  model = generated.model;
  // Auth and Storage own schemas referenced by the baseline, so both must
  // finish their initialization before application migrations are replayed.
  model.services = Object.fromEntries(['db', 'auth', 'rest', 'storage', 'mailpit'].map(name => [name, model.services[name]]));
  for (const service of Object.values(model.services)) if (service.depends_on) {
    assert.ok(Object.keys(service.depends_on).every(name => Object.hasOwn(model.services, name)));
  }
  const reserve = Object.values(model.services).reduce((sum, service) => sum + service.mem_limit, 0) + 1536 * 1048576;
  const available = Number(readFileSync('/proc/meminfo', 'utf8').match(/^MemAvailable:\s+(\d+) kB$/m)?.[1]) * 1024;
  assert.ok(available > reserve);
  const disk = statfsSync('/var/backups/barber-staging'); assert.ok(disk.bavail * disk.bsize > 8 * 1024 ** 3);
  mkdirSync(join(scratch, 'sql'), { mode: 0o700 });
  for (const [file, digest] of Object.entries(live.prepared.publicFiles).filter(([name]) => name.startsWith('sql/'))) {
    assert.match(file, /^sql\/[a-z_.-]+$/); const data = readProtected('/opt/barber-staging/supabase/' + file);
    assert.equal(checksum(data), digest); writePublicContainerSource(join(scratch, file), data);
  }
  for (const [name, service] of Object.entries(model.services)) {
    assert.equal(docker(['ps', '-aq', '--filter', `name=^/${service.container_name}$`]), '');
    assert.equal(JSON.parse(docker(['image', 'inspect', service.image]))[0].Architecture, 'amd64');
    assert.deepEqual(service.ports, []); assert.equal(service.labels[label], project);
    assert.ok(['db','auth','rest','storage','mailpit'].includes(name));
  }
  for (const volume of Object.values(model.volumes)) assert.equal(docker(['volume', 'ls', '-q', '--filter', `name=^${volume.name}$`]), '');
  const compose = args => docker(['compose', '--project-directory', scratch, '-p', project, '-f', '-', ...args], { input: JSON.stringify(model), timeout: 300000 });
  const sql = (input, database = 'postgres', user = 'postgres') => {
    assert.ok(['postgres','template1'].includes(database)); assert.ok(['postgres','supabase_admin'].includes(user));
    return docker(['exec', '-i', '-u', 'postgres', project + '-db', 'psql', '-U', user, '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-d', database], { input });
  };
  stage = 'fresh isolated core'; started = true; compose(['up', '-d', '--wait', '--wait-timeout', '240']);
  assert.equal(sql('SHOW cron.launch_active_jobs;'), 'off'); assert.equal(sql('SELECT count(*) FROM auth.users;'), '0');
  assert.equal(JSON.parse(docker(['network', 'inspect', project]))[0].Internal, true);
  for (const service of Object.values(model.services)) {
    const [actual] = JSON.parse(docker(['inspect', service.container_name]));
    assert.equal(actual.Config.Labels[label], project); assert.deepEqual(Object.keys(actual.HostConfig.PortBindings || {}), []);
    assert.deepEqual(Object.keys(actual.NetworkSettings.Networks), [project]);
  }
  stage = 'replay current four migrations';
  for (const migration of live.candidate.migrations) {
    const data = readFileSync(join(sourceRoot, 'supabase/migrations', migration.file)); assert.equal(checksum(data), migration.sha256);
    sql(`BEGIN;\n${data}\nCOMMIT;`);
  }
  const fixtures = prepareStagingFixtures(); sql(fixtures.sql);
  sql("NOTIFY pgrst, 'reload schema';");
  const ip = name => JSON.parse(docker(['inspect', project + '-' + name]))[0].NetworkSettings.Networks[project].IPAddress;
  const authOrigin = 'http://' + ip('auth') + ':9999'; const restOrigin = 'http://' + ip('rest') + ':3000';
  const request = (origin, path, options = {}) => {
    assert.ok([authOrigin, restOrigin].includes(origin)); assert.ok(path.startsWith('/') && !path.startsWith('//'));
    return fetch(origin + path, { ...options, redirect: 'manual', signal: AbortSignal.timeout(15000) });
  };
  const sessions = {};
  for (const account of fixtures.accounts) {
    const response = await request(authOrigin, '/token?grant_type=password', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(account) });
    assert.equal(response.status, 200); sessions[account.email] = await response.json();
  }
  const headers = email => ({ authorization: 'Bearer ' + sessions[email].access_token, 'content-type': 'application/json', prefer: 'return=representation' });
  const readinessDeadline = Date.now() + 15000;
  let restReady = false;
  while (Date.now() < readinessDeadline) {
    const response = await request(restOrigin, '/bookings?select=id&limit=1', { headers: headers('manager@barber.test') });
    const status = response.status; await response.arrayBuffer();
    if (status === 200) { restReady = true; break; }
    await delay(250);
  }
  assert.ok(restReady, 'Isolated PostgREST schema cache unavailable');
  const booking = (id, branch = '1', day = 12) => ({ id, branch_id: '10000000-0000-4000-8000-00000000000'+branch, barber_id: '30000000-0000-4000-8000-00000000000'+branch,
    date: '2026-11-'+day, time: '13:37:00', duration: 30, price: 0, status: 'confirmed', notes: 'synthetic-migration-rehearsal' });
  stage = 'negative control';
  const denied = await request(restOrigin, '/bookings', { method: 'POST', headers: headers('manager@barber.test'), body: JSON.stringify(booking(randomUUID())) });
  assert.equal(denied.status, 403); const error = await denied.json(); assert.equal(error.code, '42501'); assert.ok(error.message.includes('booking_reminders'));
  console.log('PASS: exact pre-fix browser-role reminder permission failure reproduced.');
  stage = 'candidate migration'; const migration = readFileSync(join(sourceRoot, 'supabase/migrations', newMigration));
  sql(`BEGIN;\n${migration}\nCOMMIT;`);
  stage = 'database regression tests';
  const counts = {};
  for (const [file, count] of [['001_baseline_security.sql',32], ['002_booking_reminder_writes.sql',35]]) {
    stage = 'database regression: ' + file;
    const tap = sql(readFileSync(join(sourceRoot,'supabase/tests',file),'utf8'));
    writeFileSync(join(sourceRoot, project + '-' + file + '-tap.txt'), tap, { flag: 'wx', mode: 0o600 });
    assert.ok(!/^not ok\b/m.test(tap)); assert.equal((tap.match(/^ok \d+\b/gm)||[]).length,count); counts[file]=count;
  }
  stage = 'browser-role API booking journeys'; const roles = ['manager','barber','agent','admin']; const createdIds=[];
  for (const [index, role] of roles.entries()) {
    const id = randomUUID(); const email = role+'@barber.test'; const values = booking(id,'1',13+index);
    const response = await request(restOrigin,'/bookings',{method:'POST',headers:headers(email),body:JSON.stringify(values)});
    assert.equal(response.status,201); assert.equal((await response.json())[0].id,id); createdIds.push(id);
    for (const patch of [{notes:'synthetic-modified'}, {status:'cancelled'}]) {
      const changed = await request(restOrigin,'/bookings?id=eq.'+id,{method:'PATCH',headers:headers(email),body:JSON.stringify(patch)});
      assert.equal(changed.status,200); const [row]=await changed.json(); assert.equal(row.id,id);
      for (const [key,value] of Object.entries(patch)) assert.equal(row[key],value);
    }
    const reminders = await request(restOrigin,'/booking_reminders?select=id',{headers:headers(email)});
    assert.equal(reminders.status,403); await reminders.arrayBuffer();
  }
  assert.equal(sql(`SELECT count(*) FROM public.booking_reminders WHERE booking_id IN (${createdIds.map(id=>"'"+id+"'").join(',')}) AND status='cancelled';`),'4');
  const other = await request(restOrigin,'/bookings',{method:'POST',headers:headers('manager@barber.test'),body:JSON.stringify(booking(randomUUID(),'2',18))});
  assert.equal(other.status,403); await other.arrayBuffer();
  const cross = await request(restOrigin,'/bookings?branch_id=eq.10000000-0000-4000-8000-000000000001',{headers:headers('manager-two@barber.test')});
  assert.equal(cross.status,200); assert.equal((await cross.json()).length,0);
  stage = 'security advisors';
  const cli = '/opt/barber-staging-closure-preparation/booking-reminders-tools/supabase';
  assert.equal(execFileSync(cli, ['--version'], { encoding: 'utf8', stdio: ['ignore','pipe','ignore'] }).trim(), '2.116.0');
  const dbHost = ip('db'); assert.ok(dbHost.startsWith('172.') && dbHost.split('.').every(part => Number.isInteger(Number(part))));
  const advisor = execFileSync(cli, ['db','advisors','--db-url','postgresql://supabase_admin@'+dbHost+':5432/postgres?sslmode=disable',
    '--type','security','--level','warn','--fail-on','none','--output','json','--agent','no'], {
    encoding: 'utf8', timeout: 60000, stdio: ['ignore','pipe','pipe'],
    env: { ...process.env, PGPASSWORD: generated.settings.variables.POSTGRES_PASSWORD,
      SUPABASE_DB_PASSWORD: generated.settings.variables.POSTGRES_PASSWORD },
  });
  writeFileSync(join(sourceRoot,project+'-security-advisors.json'),advisor,{flag:'wx',mode:0o600});
  stage = 'role-aware logical recovery';
  const candidate = { migrations: [BOOKING_REMINDER_MIGRATION] };
  const roleMetadata = validateBookingReminderRole(JSON.parse(sql(bookingReminderRoleQuery)), candidate);
  const dump = docker(['exec','-u','postgres',project+'-db','pg_dump','-U','supabase_admin','-d','postgres','--format=custom'], { encoding: null });
  const schema = docker(['exec','-u','postgres',project+'-db','pg_dump','-U','supabase_admin','-d','postgres','--schema-only','--quote-all-identifiers','--schema=public'], { encoding: null });
  writeFileSync(join(sourceRoot,'rehearsal-public-schema.sql'),schema,{flag:'wx',mode:0o600});
  const writers = ['auth','rest','storage'].map(name => project+'-'+name);
  for (const name of writers) assert.equal(JSON.parse(docker(['inspect', name]))[0].Config.Labels[label], project);
  docker(['stop','--time','15',...writers]);
  assert.equal(JSON.parse(docker(['inspect', project+'-db']))[0].Config.Labels[label], project);
  // The only dropped database is inside the fresh, labelled rehearsal container.
  sql('DROP DATABASE postgres WITH (FORCE);', 'template1', 'supabase_admin');
  sql('DROP ROLE barber_reminder_writer;', 'template1', 'supabase_admin');
  assert.equal(JSON.parse(sql(bookingReminderRoleQuery,'template1')),null);
  sql(restoreBookingReminderRoleSql(roleMetadata,candidate),'template1');
  docker(['exec','-i','-u','postgres',project+'-db','pg_restore','-U','supabase_admin','-d','template1','--create','--exit-on-error'], { input: dump, encoding: null, timeout: 90000 });
  assert.deepEqual(JSON.parse(sql(bookingReminderRoleQuery)),roleMetadata);
  const recoveryTap = sql(readFileSync(join(sourceRoot,'supabase/tests/002_booking_reminder_writes.sql'),'utf8'));
  assert.ok(!/^not ok\b/m.test(recoveryTap)); assert.equal((recoveryTap.match(/^ok \d+\b/gm)||[]).length,35);
  writeFileSync(join(sourceRoot,project+'-recovery-tap.txt'),recoveryTap,{flag:'wx',mode:0o600});
  docker(['start',...writers]);
  stage = 'live preservation';
  const after=docker(['ps','-a','--format','{{.ID}} {{.Names}} {{.Image}}']).split('\n').filter(line=>line && !line.split(' ')[1].startsWith(project+'-')).sort();
  assert.deepEqual(after,before); assert.deepEqual(readFileSync('/opt/barber-staging-test-operations/state.json'),freezeBefore);
  assert.equal(observedTestRuntime().candidateIdentity,live.candidateIdentity);
  result={schema:'barber-test-booking-migration-rehearsal/v1',at:new Date().toISOString(),project,host:'srv1207055',migration:newMigration,migrationSha256:checksum(migration),
    images:Object.fromEntries(Object.entries(model.services).map(([key,service])=>[key,service.image])),pgTap:counts,negativeControlPassed:true,
    fourRoleBookingCreateModifyCancel:true,directReminderAccessDenied:true,tenantDenial:true,securityAdvisorRun:true,writerRoleLogicalRestorePassed:true,
    fullIndependentBackupRestore:false,liveContainersAndFreezeUnchanged:true,freshSecretsAndVolumes:true,liveMigrationApplied:false,productionApproved:false};
} catch(error) {
  console.error(JSON.stringify({status:'failed',stage,project}));
  const location=String(error?.stack||'').match(/rehearse-booking-reminder-migration\.mjs:\d+:\d+/)?.[0]; if(location)console.error(location);
  // SQL diagnostics are inspected privately; no secret-bearing command output.
  if(scratch)writeFileSync(join(sourceRoot,project+'-failure.txt'),String(error?.stderr||error?.stack||'error'),{flag:'wx',mode:0o600});
  process.exitCode=1;
} finally {
  if(started&&docker&&model){try {
    for(const service of Object.values(model.services)) {
      const found=docker(['ps','-aq','--filter',`name=^/${service.container_name}$`]); if(found)assert.equal(JSON.parse(docker(['inspect',found]))[0].Config.Labels[label],project);
    }
    for(const volume of Object.values(model.volumes))assert.equal(JSON.parse(docker(['volume','inspect',volume.name]))[0].Labels[label],project);
    docker(['compose','--project-directory',scratch,'-p',project,'-f','-','down','--volumes'],{input:JSON.stringify(model),timeout:120000});
    if(result){result.labelledResourcesRemoved=true;writeFileSync(join(sourceRoot,project+'.json'),JSON.stringify(result,null,2),{flag:'wx',mode:0o600});console.log(JSON.stringify(result));}
  }catch{console.error('Only the labelled rehearsal resources require cleanup review.');process.exitCode=1;}}
  if(scratch&&existsSync(scratch))rmSync(scratch,{recursive:true});
}
