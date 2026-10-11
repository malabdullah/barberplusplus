// Observation only: no backup transfers, receipt writes to VPS, pruning or deploy.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, rmdirSync, unlinkSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { connect } from 'node:tls';
import { requirePrivate } from './pull-staging-backup.mjs';
import { TEST_POLICY, parseTestRuntime } from './test-environment-policy.mjs';
import { checksum } from './staging-private-backup-format.mjs';
import { evaluateTestObservations } from './test-monitor-observations.mjs';
import { changedProblems } from './staging-operations-policy.mjs';
import { verifyNotifier, notifyTest } from './staging-mac-notifier.mjs';

const root = '/Users/malabdullah/Library/Application Support/BarberTestOperations';
const accessPath = '/Users/malabdullah/Documents/Barber++ Staging Secrets/cloudflare-access-service-token.env';
const ssh = ['-i', '/Users/malabdullah/.ssh/barber_staging_admin_ed25519', '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10', 'barber-admin@185.97.146.8'];
let locked = false;
async function tlsExpiry(origin) {
  const host = new URL(origin).hostname;
  return await new Promise((resolve, reject) => {
    const socket = connect({ host, servername: host, port: 443, rejectUnauthorized: true }, () => {
      const expires = Date.parse(socket.getPeerCertificate().valid_to); socket.end(); resolve(expires);
    });
    socket.setTimeout(10000, () => { socket.destroy(); reject(new Error('TLS timeout')); }); socket.on('error', reject);
  });
}
try {
  assert.equal(process.platform, 'darwin'); assert.equal(process.argv.length, 2); requirePrivate(root, true);
  mkdirSync(`${root}/running`, { mode: 0o700 }); locked = true;
  const previousPath = `${root}/status.json`;
  const previous = existsSync(previousPath) ? (requirePrivate(previousPath), JSON.parse(readFileSync(previousPath))) : { checks: [] };
  requirePrivate(accessPath); const access = parseEnv(readFileSync(accessPath, 'utf8')); assert.ok(access.ACCESS_CLIENT_ID && access.ACCESS_CLIENT_SECRET);
  const headers = { 'CF-Access-Client-Id': access.ACCESS_CLIENT_ID, 'CF-Access-Client-Secret': access.ACCESS_CLIENT_SECRET };
  const network = []; const expiry = []; let remote = null;
  try { remote = JSON.parse(execFileSync('/usr/bin/ssh', [...ssh, 'sudo -n /opt/barber-staging-observer/node /opt/barber-staging-test-operations/runtime/scripts/test-environment-control.mjs --inventory'],
    { encoding: 'utf8', timeout: 45000, maxBuffer: 65536, stdio: ['ignore', 'pipe', 'ignore'] })); } catch { /* unknown below */ }
  let anon;
  for (const origin of TEST_POLICY.origins) {
    const host = new URL(origin).hostname; const app = origin === TEST_POLICY.origins[0];
    const path = app ? '/runtime-config.js' : '/auth/v1/health';
    try {
      const response = await fetch(origin + path, { redirect: 'manual', signal: AbortSignal.timeout(10000) });
      const location = response.headers.get('location');
      const protectedAccess = [302, 303, 307, 308].includes(response.status) && location && new URL(location).hostname.endsWith('.cloudflareaccess.com');
      await response.arrayBuffer();
      network.push({ check: `access:${host}`, status: protectedAccess ? 'healthy' : 'failed', reason: protectedAccess ? 'default-deny-verified' : 'access-boundary-not-verified' });
    } catch { network.push({ check: `access:${host}`, status: 'unknown', reason: 'access-observation-unavailable' }); }
    try {
      const response = await fetch(origin + path, { headers: { ...headers, ...(!app && anon ? { apikey: anon } : {}) }, redirect: 'manual', signal: AbortSignal.timeout(10000) });
      const text = await response.text();
      if (app) {
        assert.equal(response.status, 200); assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
        assert.ok(remote && checksum(Buffer.from(text)) === remote.candidate.configuration.runtime);
        const runtime = parseTestRuntime(text); assert.equal(runtime.commit, remote.candidate.commit);
        anon = runtime.anon;
        const claims = JSON.parse(Buffer.from(anon.split('.')[1], 'base64url')); assert.equal(claims.role, 'anon');
        const days = (claims.exp * 1000 - Date.now()) / 86400000; assert.ok(Number.isFinite(days));
        expiry.push({ check: 'supabase-browser-key-expiry', status: days <= 7 ? 'failed' : days <= 14 ? 'degraded' : 'healthy', reason: days <= 7 ? 'expires-within-seven-days' : days <= 14 ? 'expires-within-fourteen-days' : 'key-current' });
      } else assert.equal(response.status, 200);
      network.push({ check: `availability:${host}`, status: 'healthy', reason: 'authenticated-runtime-verified' });
    } catch { network.push({ check: `availability:${host}`, status: 'unknown', reason: 'authenticated-runtime-unavailable' }); }
    try {
      const days = (await tlsExpiry(origin) - Date.now()) / 86400000; assert.ok(Number.isFinite(days));
      expiry.push({ check: `certificate:${host}`, status: days <= 7 ? 'failed' : days <= 14 ? 'degraded' : 'healthy', reason: days <= 7 ? 'expires-within-seven-days' : days <= 14 ? 'expires-within-fourteen-days' : 'certificate-current' });
    } catch { expiry.push({ check: `certificate:${host}`, status: 'unknown', reason: 'certificate-observation-unavailable' }); }
  }
  const credentialPath = `${root}/credential-expiry.json`;
  if (existsSync(credentialPath)) {
    requirePrivate(credentialPath); const inventory = JSON.parse(readFileSync(credentialPath)); assert.equal(inventory.version, 1);
    assert.ok(Array.isArray(inventory.credentials) && inventory.credentials.length > 0);
    for (const item of inventory.credentials) {
      assert.ok(['cloudflare-access', 'github-app', 'ssh', 'tunnel'].includes(item.name));
      assert.ok(Number.isFinite(Date.parse(item.verifiedAt)) && Date.parse(item.verifiedAt) <= Date.now());
      const days = item.expiresAt === null ? Infinity : (Date.parse(item.expiresAt) - Date.now()) / 86400000;
      assert.ok(Number.isFinite(days) || item.expiresAt === null);
      expiry.push({ check: `credential:${item.name}`, status: days <= 7 ? 'failed' : days <= 14 ? 'degraded' : 'healthy', reason: days <= 7 ? 'expires-within-seven-days' : days <= 14 ? 'expires-within-fourteen-days' : 'expiry-recorded' });
    }
    assert.ok(inventory.credentials.some(item => item.name === 'cloudflare-access'));
  } else expiry.push({ check: 'credential-expiry', status: 'unknown', reason: 'credential-inventory-required' });
  let notifications = false; try { verifyNotifier(); notifications = true; } catch { /* unknown */ }
  const status = evaluateTestObservations({ remote, network, expiry, notifications, previousAt: previous.checkedAt });
  const next = `${root}/status.next.json`; writeFileSync(next, JSON.stringify(status, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); renameSync(next, previousPath);
  const changes = changedProblems(previous.checks, status.checks).filter(item => !item.includes('recorded-test-maintenance'));
  if (existsSync(`${root}/failure-notified.json`)) { requirePrivate(`${root}/failure-notified.json`); unlinkSync(`${root}/failure-notified.json`); changes.push('monitor:recovered'); }
  if (changes.length && notifications) notifyTest(changes.join('; ').slice(0, 500));
  console.log(JSON.stringify({ overall: status.overall, checkedAt: status.checkedAt, changes, productionApproved: false }));
} catch {
  try {
    requirePrivate(root, true);
    if (!existsSync(`${root}/failure-notified.json`)) {
      notifyTest('Test monitoring is unavailable. Inspect the private report and operation lock.');
      writeFileSync(`${root}/failure-notified.json`, JSON.stringify({ at: new Date().toISOString(), status: 'unknown' }), { flag: 'wx', mode: 0o600 });
    }
  } catch { /* Local stderr remains the fallback. */ }
  console.error('Test monitor unavailable; observations unknown.'); process.exitCode = 1;
} finally { if (locked) rmdirSync(`${root}/running`); }
