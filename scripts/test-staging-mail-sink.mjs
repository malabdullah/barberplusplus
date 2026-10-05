// Opt-in Docker integration test. Input: rendered staging Compose JSON on stdin.
// Creates/removes only uniquely named test resources; never starts Supabase.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { validateCompose } from './check-vps-compose.mjs';

const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 }).trim();
let config;
try { config = JSON.parse(readFileSync(0, 'utf8')); }
catch { throw new Error('Invalid Compose JSON; input suppressed'); }
validateCompose(config);
const sink = config.services.mailpit;
const name = `barber-mail-sink-test-${randomUUID()}`;
const probeImage = 'node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e';
let networkCreated = false;
let containerCreated = false;

async function smtp(connect) {
  const socket = connect({ host: '127.0.0.1', port: 1025 });
  socket.setTimeout(5000, () => socket.destroy(new Error('SMTP timeout')));
  let buffer = '';
  let waiter;
  let failure;
  const consume = () => {
    const match = buffer.match(/(?:^|\r\n)(\d{3}) [^\r\n]*\r\n/);
    if (!match || !waiter) return;
    buffer = buffer.slice(match.index + match[0].length);
    const resolve = waiter.resolve;
    waiter = undefined;
    resolve(Number(match[1]));
  };
  socket.on('data', (data) => { buffer += data.toString(); consume(); });
  socket.on('error', (error) => { failure = error; waiter?.reject(error); });
  const response = () => new Promise((resolve, reject) => {
    if (failure) return reject(failure);
    waiter = { resolve, reject }; consume();
  });
  const command = (value) => { socket.write(`${value}\r\n`); return response(); };
  try {
    assert.equal(await response(), 220);
    assert.equal(await command('EHLO barber.test'), 250);
    assert.equal(await command('MAIL FROM:<no-reply@barber.test>'), 250);
    assert.equal(await command('RCPT TO:<admin@barber.test>'), 250);
    assert.equal(await command('DATA'), 354);
    assert.equal(await command('From: no-reply@barber.test\r\nTo: admin@barber.test\r\nSubject: Synthetic staging mail test\r\n\r\nSynthetic fixture only.\r\n.'), 250);
    for (const recipient of ['customer@example.invalid', 'admin@barber.test.attacker.invalid']) {
      assert.equal(await command('RSET'), 250);
      assert.equal(await command('MAIL FROM:<no-reply@barber.test>'), 250);
      const code = await command(`RCPT TO:<${recipient}>`);
      assert.ok(code >= 500 && code < 600, 'Non-synthetic recipient must be rejected');
    }
    await command('QUIT');
  } finally { socket.destroy(); }
}

try {
  docker('pull', sink.image);
  docker('pull', probeImage);
  docker('network', 'create', '--internal', '--label', 'barber.purpose=mail-sink-test', name);
  networkCreated = true;
  // Probe from the same isolated network namespace; never publish test ports.
  const args = ['create', '--name', name, '--label', 'barber.purpose=mail-sink-test',
    '--network', name, '--user', sink.user, '--read-only', '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges:true', '--tmpfs', sink.tmpfs[0],
    '--memory', String(sink.mem_limit), '--cpus', String(sink.cpus), '--pids-limit', String(sink.pids_limit)];
  for (const [key, value] of Object.entries(sink.environment)) args.push('-e', `${key}=${value}`);
  docker(...args, sink.image);
  containerCreated = true;
  docker('start', name);
  await delay(500);
  const state = JSON.parse(docker('inspect', name))[0];
  if (!state.State.Running) {
    // This container receives only the validated, synthetic mail-sink settings.
    console.error(docker('logs', name));
    throw new Error('Synthetic mail-sink test container exited');
  }
  assert.equal(state.Config.User, '10001:10001');
  assert.equal(state.HostConfig.ReadonlyRootfs, true);
  assert.deepEqual(Object.keys(state.NetworkSettings.Networks), [name]);
  assert.equal(JSON.parse(docker('network', 'inspect', name))[0].Internal, true);
  assert.ok(Object.values(state.NetworkSettings.Ports).every((bindings) => !bindings?.length));
  const probe = `
    import assert from 'node:assert/strict';
    import { connect } from 'node:net';
    import { setTimeout as delay } from 'node:timers/promises';
    const base = 'http://127.0.0.1:8025';
    let ready = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        if ((await fetch(base + '/livez', { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; }
      } catch {}
      await delay(200);
    }
    assert.ok(ready, 'Mail sink did not become ready');
    await (${smtp.toString()})(connect);
    const messages = await (await fetch(base + '/api/v1/messages', { signal: AbortSignal.timeout(3000) })).json();
    assert.equal(messages.total, 1, 'Only the synthetic message may enter the inbox');
  `;
  execFileSync('docker', ['run', '--rm', '-i', '--name', `${name}-probe`,
    '--network', `container:${name}`, '--user', '10001:10001', '--read-only',
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
    probeImage, 'node', '--input-type=module'],
  { input: probe, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 60000 });
  // Linux internal bridges must have no default route (neither IPv4 nor IPv6).
  const routes = docker('exec', name, 'cat', '/proc/net/route').split('\n').slice(1);
  assert.ok(routes.every((line) => line.trim().split(/\s+/)[1] !== '00000000'), 'Unexpected IPv4 default route');
  const routes6 = docker('exec', name, 'cat', '/proc/net/ipv6_route').split('\n').filter(Boolean);
  assert.ok(routes6.every((line) => {
    const fields = line.trim().split(/\s+/);
    return fields[0] !== '0'.repeat(32) || fields[1] !== '00' || fields.at(-1) === 'lo';
  }), 'Unexpected IPv6 default route');
  console.log('PASS: pinned non-root mail sink, internal-only network, no default route, synthetic mail capture, outside-recipient rejection.');
} finally {
  try { docker('rm', '-f', `${name}-probe`); } catch { /* --rm already cleaned it */ }
  if (containerCreated) docker('rm', '-f', name);
  if (networkCreated) docker('network', 'rm', name);
}
