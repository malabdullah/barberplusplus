import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, realpathSync, chmodSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import { prepareLocalServicePins } from './prepare-local-service-pins.mjs';
import { localDockerProbe } from './local-docker-probe.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const lock = JSON.parse(readFileSync(resolve(root, 'ops/local-test/runtime.json')));
const cli = resolve(root, 'node_modules/.bin/supabase');
const state = resolve(root, '.local-test');
const db = `supabase_db_${lock.project}`;
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(SUPABASE_|PGHOST|PGPORT|PGDATABASE|PGUSER|PGPASSWORD|DATABASE_URL|PRODUCTION_)/.test(k)));
let dockerProbe;

export function assertLocalConfig(config) {
  if (!/^project_id\s*=\s*"barber-local-test"$/m.test(config)) throw Error('Unexpected local project');
  for (const [section, port] of [['api', lock.apiPort], ['db', lock.databasePort]]) {
    const block = config.match(new RegExp(`^\\[${section}\\]\\s*\\n([\\s\\S]*?)(?=^\\[|(?![\\s\\S]))`, 'm'))?.[1];
    if (!block || !new RegExp(`^port\\s*=\\s*${port}\\s*$`, 'm').test(block)) throw Error('Unexpected local ports');
  }
  if (!/^site_url\s*=\s*"http:\/\/localhost:5173"$/m.test(config)) throw Error('Non-local Auth origin');
}

function run(command, args, options = {}) {
  const p = spawnSync(command, args, { cwd: root, env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, ...options });
  if (p.status !== 0 && options.sensitive) { mkdirSync(state, { recursive: true, mode: 0o700 }); writeFileSync(resolve(state, 'last-error.log'), p.stderr || '', { mode: 0o600 }); }
  if (p.status !== 0) throw Error(`${command.split('/').pop()} failed (${p.status ?? 'signal'}). ${options.sensitive ? 'Private diagnostics suppressed.' : (p.stderr || '').slice(-1500)}`);
  return p.stdout || '';
}
function supabase(...args) { return run(cli, [...args, '--workdir', root], { sensitive: true }); }
function docker(...args) { return run('docker', args); }
function inspect(name) { return JSON.parse(docker('inspect', name))[0]; }
function guard() {
  assertLocalConfig(readFileSync(resolve(root, 'supabase/config.toml'), 'utf8'));
  if (existsSync(resolve(root, 'supabase/.temp/project-ref'))) throw Error('Linked project refused');
  if (realpathSync(root) !== root) throw Error('Symlink workspace refused');
  dockerProbe ||= localDockerProbe();
  env.DOCKER_HOST = dockerProbe.endpoint;
  delete env.DOCKER_CONTEXT;
  functionSecrets();
  if (supabase('--version').trim() !== lock.cli) throw Error('Unreviewed CLI version');
}
function privateWrite(path, contents) { writeFileSync(path, contents, { mode: 0o600 }); chmodSync(path, 0o600); }
function functionSecrets() {
  const path = resolve(root, 'supabase/functions/.env.local');
  if (!existsSync(path)) privateWrite(path, `APP_ENV=development\nAPP_URL=http://localhost:5173\nSUPABASE_PUBLIC_URL=http://127.0.0.1:${lock.apiPort}\nCRON_SHARED_SECRET=${randomBytes(32).toString('hex')}\n`);
  if (!/^CUSTOMER_BOOKING_TEST_API_URL=/m.test(readFileSync(path, 'utf8'))) {
    privateWrite(path, readFileSync(path, 'utf8').trimEnd() + `\nCUSTOMER_BOOKING_TEST_API_URL=http://127.0.0.1:${lock.apiPort}\n`);
  }
  const secret = readFileSync(path, 'utf8').match(/^CRON_SHARED_SECRET=([A-Za-z0-9_-]{32,128})$/m)?.[1];
  if (!secret) throw Error('A private local cron secret is required');
  env.BARBER_LOCAL_CRON_SECRET = secret;
}
function owned(name) {
  const c = inspect(name);
  if (c.Config.Labels?.['com.supabase.cli.project'] !== lock.project) throw Error('Container ownership mismatch');
  return c;
}
function workspaceOwner(create = false) {
  // One named Test profile has one checkout owner. A fresh clone must never
  // mistake another checkout's initialized database for disposable new data.
  const name = `${lock.project}-workspace-owner`;
  const found = spawnSync('docker', ['volume', 'inspect', name], { cwd: root, env, encoding: 'utf8' });
  if (found.status !== 0) {
    if (!create) throw Error('Local profile ownership is missing; run setup');
    docker('volume', 'create', '--label', `barber.workspace=${root}`, '--label', `barber.project=${lock.project}`, name);
  }
  const volume = JSON.parse(docker('volume', 'inspect', name))[0];
  if (volume.Labels?.['barber.workspace'] !== root || volume.Labels?.['barber.project'] !== lock.project) throw Error('This Test profile belongs to another checkout; refusing to reset or stop its data');
}
function sql(query) {
  owned(db);
  return run('docker', ['exec', '-i', db, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'supabase_admin', '-d', 'postgres'], { input: query, sensitive: true });
}
async function engine(method, path, body) {
  const endpoint = dockerProbe.endpoint;
  return new Promise((accept, reject) => {
    const req = http.request({ socketPath: endpoint.slice(7), path, method, headers: { 'Content-Type': 'application/json' } }, res => {
      let data = ''; res.on('data', b => { data += b; }); res.on('end', () => {
        if (res.statusCode >= 400) return reject(Error(`Local Docker API failed: ${res.statusCode}`));
        accept(data ? JSON.parse(data) : null);
      });
    });
    req.on('error', reject); req.end(body ? JSON.stringify(body) : undefined);
  });
}
async function loopbackOnly() {
  const ids = docker('ps', '-aq', '--filter', `label=com.supabase.cli.project=${lock.project}`).trim().split(/\s+/).filter(Boolean);
  for (const id of ids) {
    const c = inspect(id); const bindings = c.HostConfig.PortBindings || {};
    if (!Object.values(bindings).flat().some(b => !['127.0.0.1', '::1'].includes(b.HostIp))) continue;
    const name = c.Name.slice(1); owned(name);
    const config = { ...c.Config, Image: c.Image, Hostname: '', HostConfig: { ...c.HostConfig, PortBindings: Object.fromEntries(Object.entries(bindings).map(([p, rows]) => [p, rows.map(b => ({ ...b, HostIp: '127.0.0.1' }))])) }, NetworkingConfig: { EndpointsConfig: Object.fromEntries(Object.entries(c.NetworkSettings.Networks).map(([n, v]) => [n, { Aliases: (v.Aliases || []).filter(a => !c.Id.startsWith(a)) }])) } };
    const gatewayArchive = name.startsWith('supabase_kong_') ? run('docker', ['cp', `${name}:/home/kong`, '-'], { encoding: null, sensitive: true }) : null;
    await engine('POST', `/containers/${c.Id}/stop?t=15`);
    await engine('DELETE', `/containers/${c.Id}`);
    const created = await engine('POST', `/containers/create?name=${encodeURIComponent(name)}`, config);
    if (gatewayArchive) run('docker', ['cp', '-a', '-', `${name}:/home`], { input: gatewayArchive, sensitive: true });
    await engine('POST', `/containers/${created.Id}/start`);
  }
  const all = docker('ps', '-aq', '--filter', `label=com.supabase.cli.project=${lock.project}`).trim().split(/\s+/).filter(Boolean);
  for (const id of all) {
    const c = inspect(id);
    if (Object.values(c.HostConfig.PortBindings || {}).flat().some(b => !['127.0.0.1', '::1'].includes(b.HostIp))) throw Error('Non-loopback Docker publish refused');
  }
}
async function ready() {
  for (let i = 0; i < 90; i++) {
    try {
      const response = await fetch(`http://127.0.0.1:${lock.apiPort}/auth/v1/health`, { signal: AbortSignal.timeout(2000) });
      if (response.ok && owned(db).State.Health?.Status === 'healthy') return;
    } catch { /* Services may be restarting after binding hardening. */ }
    await new Promise(r => setTimeout(r, 1000));
  }
  throw Error('Local Auth did not become healthy');
}
function baseline() {
  return JSON.parse(sql("SELECT json_build_object('users',(SELECT count(*) FROM auth.users),'bookings',(SELECT count(*) FROM public.bookings),'cron_jobs_active',(SELECT count(*) FROM cron.job WHERE active));"));
}
function disableCron() { sql("ALTER SYSTEM SET cron.launch_active_jobs='off'; SELECT pg_reload_conf(); UPDATE cron.job SET active=false WHERE active;"); }
function configure() {
  const values = JSON.parse(supabase('status', '-o', 'json'));
  const key = values.PUBLISHABLE_KEY || values.ANON_KEY;
  if (!key || new URL(values.API_URL).hostname !== '127.0.0.1' || new URL(values.API_URL).port !== String(lock.apiPort)) throw Error('Unexpected local API status');
  privateWrite(resolve(root, '.env.local'), `VITE_APP_ENV=test\nVITE_APP_URL=http://localhost:5173\nVITE_SUPABASE_URL=http://127.0.0.1:${lock.apiPort}\nVITE_SUPABASE_PUBLISHABLE_KEY=${key}\n`);
  functionSecrets();
}
async function startBackend() {
  prepareLocalServicePins(root);
  supabase('start', '--exclude', 'logflare,vector');
  disableCron();
  await loopbackOnly();
  await ready();
  configure();
}
async function freeAppPort() {
  await new Promise((accept, reject) => {
    const server = net.createServer(); server.once('error', () => reject(Error('Port 5173 is occupied; refusing a fallback port')));
    server.listen(lock.appPort, '127.0.0.1', () => server.close(accept));
  });
}
async function app() {
  await freeAppPort();
  const child = spawn(resolve(root, 'node_modules/.bin/vite'), ['--host', '127.0.0.1', '--port', '5173', '--strictPort'], { cwd: root, env, stdio: 'inherit' });
  mkdirSync(state, { recursive: true, mode: 0o700 });
  privateWrite(resolve(state, 'app.json'), JSON.stringify({ pid: child.pid, root, project: lock.project }));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal));
  await new Promise((accept, reject) => { child.once('error', reject); child.once('exit', code => { process.exitCode = code || 0; accept(); }); });
}
export async function main(action) {
  guard(); mkdirSync(state, { recursive: true, mode: 0o700 });
  const marker = resolve(state, 'initialized.json');
  if (action === 'setup' && !existsSync(marker) && spawnSync('docker', ['inspect', db], { env, encoding: 'utf8' }).status === 0) throw Error('Existing uninitialized-profile database refused; inspect ownership before adoption');
  workspaceOwner(action === 'setup');
  if (action === 'setup') {
    const existed = existsSync(marker);
    await startBackend();
    if (!existed) {
      supabase('db', 'reset', '--local', '--yes'); disableCron(); await loopbackOnly(); await ready(); configure();
      privateWrite(marker, JSON.stringify({ project: lock.project, root, created: new Date().toISOString() }));
    }
    console.log(`Local Test ready. ${JSON.stringify(baseline())}. Run npm run local:start`);
  } else if (action === 'start') {
    if (!existsSync(marker)) throw Error('Run npm run local:setup first');
    await startBackend(); await app();
  } else if (action === 'reset') {
    if (!existsSync(marker)) throw Error('Uninitialized project refused');
    owned(db); supabase('db', 'reset', '--local', '--yes'); disableCron(); await loopbackOnly(); await ready(); configure(); console.log(JSON.stringify(baseline()));
  } else if (action === 'stop') {
    const path = resolve(state, 'app.json');
    if (existsSync(path)) {
      const receipt = JSON.parse(readFileSync(path));
      if (receipt.root === root && receipt.project === lock.project && Number.isInteger(receipt.pid)) {
        const command = spawnSync('ps', ['-p', String(receipt.pid), '-o', 'command='], { encoding: 'utf8' }).stdout || '';
        if (command.includes(root) && command.includes('vite')) { try { process.kill(receipt.pid, 'SIGTERM'); } catch { /* Already stopped. */ } }
      }
    }
    supabase('stop', '--project-id', lock.project); console.log('Local Test stopped; data volumes retained');
  } else if (action === 'status') { console.log(JSON.stringify(baseline())); }
  else throw Error('Expected setup, start, stop, reset, or status');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv[2]).catch(error => { console.error(error.message); process.exitCode = 1; });
