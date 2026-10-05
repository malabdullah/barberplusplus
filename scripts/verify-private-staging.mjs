import assert from 'node:assert/strict';
import { createPublicKey } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { localDockerProbe } from './local-docker-probe.mjs';
import { fullStackClient } from './staging-full-stack-client.mjs';
import { assertNoDefaultRoute } from './staging-full-stack-probe.mjs';
import { isPrivateStorageDenied } from './rehearse-staging-core-recovery.mjs';
import { APPROVED_SOURCE, INSTALL_ROOT, PROJECT, OWNER_LABEL, SERVICES, validatePrivateModel } from './staging-private-model.mjs';

let stage = 'preflight';
let sql;
let policy = false;
try {
  assert.equal(hostname(), 'srv1207055'); assert.equal(process.getuid(), 0);
  const root = lstatSync(INSTALL_ROOT);
  assert.ok(root.isDirectory() && !root.isSymbolicLink() && (root.mode & 0o077) === 0);
  assert.ok(existsSync(`${INSTALL_ROOT}/initialized.json`) && !existsSync(`${INSTALL_ROOT}/functional-check-started.json`));
  const model = JSON.parse(readFileSync(`${INSTALL_ROOT}/compose.private.json`)); validatePrivateModel(model);
  const accounts = JSON.parse(readFileSync(`${INSTALL_ROOT}/synthetic-accounts.json`));
  const integrations = JSON.parse(readFileSync(`${INSTALL_ROOT}/synthetic-integration.json`));
  const env = model.services.functions.environment;
  const docker = localDockerProbe();
  sql = (input) => docker(['exec', '-i', '-u', 'postgres', `${PROJECT}-db`,
    'psql', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-d', 'postgres'], { input }).trim();
  stage = 'running isolation';
  for (const name of SERVICES) {
    const [state] = JSON.parse(docker(['inspect', `${PROJECT}-${name}`]));
    assert.equal(state.Config.Labels[OWNER_LABEL], APPROVED_SOURCE);
    assert.equal(state.State.Running, true);
    assert.deepEqual(Object.keys(state.HostConfig.PortBindings || {}), []);
    assert.deepEqual(Object.keys(state.NetworkSettings.Networks), [PROJECT]);
    for (const mount of state.Mounts) {
      assert.ok(mount.Type === 'tmpfs' || (mount.Type === 'volume'
        ? Object.values(model.volumes).some((volume) => volume.name === mount.Name)
        : mount.Type === 'bind' && !mount.RW && model.services[name].volumes.some((expected) => expected.source === mount.Source && expected.target === mount.Destination)));
    }
    if (['realtime', 'functions', 'api-gw', 'mailpit'].includes(name)) {
      assert.equal(state.Config.User, model.services[name].user);
      assert.equal(state.HostConfig.ReadonlyRootfs, true);
      assert.deepEqual(state.HostConfig.CapDrop, ['ALL']);
      assert.ok(state.HostConfig.SecurityOpt.includes('no-new-privileges:true'));
    }
  }
  assert.equal(JSON.parse(docker(['network', 'inspect', PROJECT]))[0].Internal, true);
  assertNoDefaultRoute(docker(['exec', `${PROJECT}-storage`, 'cat', '/proc/net/route']),
    docker(['exec', `${PROJECT}-storage`, 'cat', '/proc/net/ipv6_route']));
  assert.equal(sql('SHOW cron.launch_active_jobs;'), 'off');
  assert.equal(sql('SELECT count(*) FROM supabase_migrations.schema_migrations;'), '4');
  assert.equal(sql('SELECT count(*) FROM storage.buckets;'), '0');
  writeFileSync(`${INSTALL_ROOT}/functional-check-started.json`, JSON.stringify({ at: new Date().toISOString() }), { flag: 'wx', mode: 0o600 });
  stage = 'synthetic email and Storage fixture';
  const settings = { anon: env.SUPABASE_ANON_KEY, key: env.SUPABASE_SERVICE_ROLE_KEY, ...integrations,
    password: accounts.find((account) => account.email === 'admin@barber.test').password,
    barberPassword: accounts.find((account) => account.email === 'barber@barber.test').password,
    otherManagerPassword: accounts.find((account) => account.email === 'manager-two@barber.test').password,
    flowPublic: createPublicKey(env.WHATSAPP_FLOW_PRIVATE_KEY).export({ type: 'spki', format: 'pem' }).toString() };
  const setup = async (input) => {
    const ok = (value) => { if (!value) throw new Error('PRIVATE_SETUP_FAILED'); };
    const headers = { Authorization: 'Bearer ' + input.key, 'Content-Type': 'application/json' };
    const invite = await fetch('http://auth:9999/invite', { method: 'POST', headers, body: JSON.stringify({ email: 'invite-probe@barber.test' }) });
    ok(invite.status === 200);
    const inbox = await (await fetch('http://mailpit:8025/api/v1/messages')).json(); ok(inbox.total === 1);
    const bucket = await fetch('http://storage:5000/bucket', { method: 'POST', headers, body: JSON.stringify({ id: 'synthetic-probe', name: 'synthetic-probe', public: false }) });
    ok(bucket.status === 200);
    const object = await fetch('http://storage:5000/object/synthetic-probe/check.txt', { method: 'POST',
      headers: { Authorization: headers.Authorization, 'Content-Type': 'text/plain' }, body: 'synthetic-only' });
    ok(object.status === 200);
    console.log('PASS: synthetic invitation captured by Mailpit and private Storage fixture created');
  };
  console.log(docker(['exec', '-i', `${PROJECT}-storage`, 'node', '--input-type=module'],
    { input: `await (${setup.toString()})(${JSON.stringify({ key: settings.key })});` }));
  stage = 'bounded Realtime test policy';
  const admin = sql("SELECT id FROM auth.users WHERE email='admin@barber.test';");
  assert.match(admin, /^[a-f0-9-]{36}$/);
  sql(`CREATE POLICY full_stack_probe_read ON realtime.messages FOR SELECT TO authenticated
    USING ((select auth.uid()) = '${admin}'::uuid AND realtime.topic()='probe-allowed');
    CREATE POLICY full_stack_probe_write ON realtime.messages FOR INSERT TO authenticated
    WITH CHECK ((select auth.uid()) = '${admin}'::uuid AND realtime.topic()='probe-allowed');`);
  policy = true;
  stage = 'live gateway and service checks';
  console.log(docker(['exec', '-i', `${PROJECT}-storage`, 'node', '--input-type=module'],
    { input: `await (${fullStackClient.toString()})(${JSON.stringify(settings)}, (${isPrivateStorageDenied.toString()}));`, timeout: 180000 }));
  stage = 'test policy cleanup';
  sql('DROP POLICY full_stack_probe_read ON realtime.messages; DROP POLICY full_stack_probe_write ON realtime.messages;');
  policy = false;
  writeFileSync(`${INSTALL_ROOT}/functional-verified.json`, JSON.stringify({ source: APPROVED_SOURCE, at: new Date().toISOString(),
    services: SERVICES, publicPorts: false, isolationVerified: true, fullReleaseAccepted: false }), { flag: 'wx', mode: 0o600 });
  console.log('PASS: permanent private staging functional checks; no public release acceptance.');
} catch {
  console.error(`Private staging verification failed at: ${stage}. Data retained.`);
  process.exitCode = 1;
} finally {
  if (policy && sql) {
    try { sql('DROP POLICY IF EXISTS full_stack_probe_read ON realtime.messages; DROP POLICY IF EXISTS full_stack_probe_write ON realtime.messages;'); }
    catch { console.error('Temporary Realtime policy cleanup requires attention.'); process.exitCode = 1; }
  }
}
