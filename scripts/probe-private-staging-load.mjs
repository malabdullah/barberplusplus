import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { localDockerProbe } from './local-docker-probe.mjs';
import { APPROVED_SOURCE, INSTALL_ROOT, PROJECT, OWNER_LABEL, SERVICES, validatePrivateModel } from './staging-private-model.mjs';

try {
  assert.equal(hostname(), 'srv1207055'); assert.equal(process.getuid(), 0);
  const model = JSON.parse(readFileSync(`${INSTALL_ROOT}/compose.private.json`)); validatePrivateModel(model);
  const accounts = JSON.parse(readFileSync(`${INSTALL_ROOT}/synthetic-accounts.json`));
  const docker = localDockerProbe();
  const inventory = () => Object.fromEntries(SERVICES.map((name) => {
    const [state] = JSON.parse(docker(['inspect', `${PROJECT}-${name}`]));
    assert.equal(state.Config.Labels[OWNER_LABEL], APPROVED_SOURCE);
    assert.equal(state.State.Running, true); assert.equal(state.State.OOMKilled, false);
    return [name, { id: state.Id, restartCount: state.RestartCount }];
  }));
  const before = inventory();
  const probe = async (input) => {
    const login = await fetch('http://api-gw:8000/auth/v1/token?grant_type=password', { method: 'POST',
      headers: { apikey: input.anon, 'Content-Type': 'application/json' }, body: JSON.stringify(input.account), signal: AbortSignal.timeout(5000) });
    if (login.status !== 200) throw new Error('LOAD_LOGIN_FAILED');
    const session = await login.json();
    const headers = { apikey: input.anon, authorization: 'Bearer ' + session.access_token };
    const routes = ['/auth/v1/user', '/rest/v1/branches?select=id&limit=5', '/functions/v1/get-kuwait-governorates'];
    const latencies = []; let errors = 0; let requests = 0;
    const started = performance.now(); const deadline = started + 30000;
    await Promise.all(Array.from({ length: 5 }, async (_, worker) => {
      for (let i = 0; i < 70 && performance.now() < deadline; i++) {
        const at = performance.now(); requests++;
        try {
          const response = await fetch('http://api-gw:8000' + routes[(worker + i) % routes.length], { headers, signal: AbortSignal.timeout(5000) });
          await response.arrayBuffer(); if (response.status !== 200) errors++;
        } catch { errors++; }
        latencies.push(performance.now() - at);
        await new Promise((resolve) => setTimeout(resolve, Math.max(0, 500 - (performance.now() - at))));
      }
    }));
    latencies.sort((a, b) => a - b);
    console.log(JSON.stringify({ durationMs: Math.round(performance.now() - started), concurrency: 5, targetRps: 10,
      requests, errors, p95Ms: Math.round(latencies[Math.floor(latencies.length * 0.95)]), maxMs: Math.round(latencies.at(-1)),
      scope: '30-second-read-only-backend-probe-not-capacity-acceptance' }));
  };
  const result = JSON.parse(docker(['exec', '-i', `${PROJECT}-storage`, 'node', '--input-type=module'], {
    input: `await (${probe.toString()})(${JSON.stringify({ anon: model.services.functions.environment.SUPABASE_ANON_KEY,
      account: accounts.find((account) => account.email === 'admin@barber.test') })});`, timeout: 60000,
  }));
  assert.deepEqual(inventory(), before, 'Service identity/restart count changed');
  assert.equal(result.errors, 0); assert.ok(result.requests >= 250 && result.p95Ms < 1000);
  writeFileSync(`${INSTALL_ROOT}/bounded-load-verified.json`, JSON.stringify({ ...result, source: APPROVED_SOURCE,
    at: new Date().toISOString(), noRestartsOrOom: true, fullCapacityAccepted: false }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ ...result, noRestartsOrOom: true }));
} catch {
  console.error('Bounded private staging load check failed; no capacity acceptance.');
  process.exitCode = 1;
}
