import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync, lstatSync, rmdirSync, rmSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { backupRoot, keyRoot, requirePrivate, pullBackup, validateId, validateManifest, verifyEncryptedFile } from './pull-staging-backup.mjs';
import { backupReadiness, changedProblems, maintenanceWindow, POLICY } from './staging-operations-policy.mjs';
import { manualFirstRelease as release } from './staging-manual-first-release.mjs';
import { connect } from 'node:tls';

const stateRoot = '/Users/malabdullah/Library/Application Support/BarberStagingOperations';
const accessPath = '/Users/malabdullah/Documents/Barber++ Staging Secrets/cloudflare-access-service-token.env';
const ssh = ['-i', '/Users/malabdullah/.ssh/barber_staging_admin_ed25519', '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes',
  '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10', 'barber-admin@185.97.146.8'];
const operations = '/opt/barber-staging-observer/node /opt/barber-staging-operations/scripts/staging-operations-read.mjs';
let locked = false;
try {
  assert.equal(process.platform, 'darwin'); assert.equal(process.argv.length, 2);
  requirePrivate(stateRoot, true);
  const lock = `${stateRoot}/running`; mkdirSync(lock, { mode: 0o700 }); locked = true;
  const previousPath = `${stateRoot}/status.json`;
  const previous = existsSync(previousPath) ? (requirePrivate(previousPath), JSON.parse(readFileSync(previousPath))) : { checks: [] };
  requirePrivate(accessPath); const accessEnv = parseEnv(readFileSync(accessPath, 'utf8'));
  assert.ok(accessEnv.ACCESS_CLIENT_ID && accessEnv.ACCESS_CLIENT_SECRET);
  const headers = { 'CF-Access-Client-Id': accessEnv.ACCESS_CLIENT_ID, 'CF-Access-Client-Secret': accessEnv.ACCESS_CLIENT_SECRET };
  const checks = []; const now = Date.now();
  let anonKey;
  if (previous.checkedAt && now - Date.parse(previous.checkedAt) > POLICY.intervalMs * 2) checks.push({ check: 'monitor-gap', status: 'degraded', reason: 'mac-offline-or-checks-missed' });
  else checks.push({ check: 'monitor-gap', status: 'healthy', reason: 'checks-current' });
  for (const origin of [release.appUrl, release.apiUrl]) {
    try {
      const url = origin + (origin === release.appUrl ? '/runtime-config.js' : '/auth/v1/health');
      const denied = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10000) });
      assert.ok([302, 303, 307, 308].includes(denied.status));
      assert.ok(new URL(denied.headers.get('location')).hostname.endsWith('.cloudflareaccess.com'));
      await denied.arrayBuffer();
      // No automatic redirect: Access credentials cannot leak to another host.
      const authenticated = await fetch(origin + (origin === release.appUrl ? '/runtime-config.js' : '/auth/v1/health'),
        { headers: { ...headers, ...(origin === release.apiUrl && anonKey ? { apikey: anonKey } : {}) }, redirect: 'manual', signal: AbortSignal.timeout(10000) });
      if (origin === release.appUrl) {
        assert.equal(authenticated.status, 200);
        const runtime = await authenticated.text(); assert.ok(runtime.includes(release.commit) && runtime.includes(`supabaseUrl: '${release.appUrl}'`));
        anonKey = runtime.match(/supabasePublishableKey:\s*'([^']+)'/)?.[1]; assert.ok(anonKey);
        const claims = JSON.parse(Buffer.from(anonKey.split('.')[1], 'base64url')); assert.equal(claims.role, 'anon');
        const keyDays = (claims.exp * 1000 - now) / 86400000; assert.ok(Number.isFinite(keyDays));
        checks.push({ check: 'supabase-browser-key-expiry', status: keyDays <= 7 ? 'failed' : keyDays <= 14 ? 'degraded' : 'healthy',
          reason: keyDays <= 7 ? 'expires-within-seven-days' : keyDays <= 14 ? 'expires-within-fourteen-days' : 'key-current' });
        assert.equal(authenticated.headers.get('x-robots-tag'), 'noindex, nofollow');
      } else { assert.equal(authenticated.status, 200); await authenticated.arrayBuffer(); }
      checks.push({ check: new URL(origin).hostname, status: 'healthy', reason: 'https-and-access-verified' });
    } catch { checks.push({ check: new URL(origin).hostname, status: 'unknown', reason: 'https-access-or-runtime-unavailable' }); }
  }
  let remote;
  try {
    const exports = JSON.parse(execFileSync('ssh', [...ssh, `sudo -n ${operations} --exports`], { encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'ignore'] }));
    assert.ok(Array.isArray(exports) && exports.length <= 1024);
    for (const manifest of exports.filter(item => item.status === 'complete').sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))) {
      validateManifest(Object.fromEntries(['version', 'id', 'environment', 'sourceHost', 'kind', 'file', 'sha256', 'bytes', 'createdAt'].map(key => [key, manifest[key]])), manifest.id);
      const directory = `${backupRoot}/${manifest.id}`;
      if (!existsSync(directory)) await pullBackup(manifest.id);
      else {
        requirePrivate(directory, true); requirePrivate(`${directory}/receipt.json`); requirePrivate(`${directory}/manifest.json`);
        const localManifest = JSON.parse(readFileSync(`${directory}/manifest.json`)); validateManifest(localManifest, manifest.id);
        assert.equal(localManifest.sha256, manifest.sha256); assert.equal(localManifest.bytes, manifest.bytes);
        // Reauthenticate existing destinations: directory existence is not evidence.
        await verifyEncryptedFile(`${directory}/payload.tar.age`, localManifest, `${keyRoot}/identity.txt`);
      }
      const receipt = JSON.parse(readFileSync(`${directory}/receipt.json`));
      assert.equal(receipt.id, manifest.id); assert.equal(receipt.sha256, manifest.sha256); assert.equal(receipt.status, 'encrypted-transfer-verified');
      const ack = JSON.parse(execFileSync('ssh', [...ssh, `sudo -n ${operations} --ack ${manifest.id}`],
        { input: JSON.stringify(receipt), encoding: 'utf8', timeout: 20000, stdio: ['pipe', 'pipe', 'ignore'] }));
      assert.equal(ack.id, manifest.id); assert.equal(ack.acknowledged, true);
      const ackPath = `${directory}/remote-ack.json`;
      if (existsSync(ackPath)) { requirePrivate(ackPath); const old = JSON.parse(readFileSync(ackPath)); assert.equal(old.id, manifest.id); assert.equal(old.sha256, manifest.sha256); }
      else writeFileSync(ackPath, JSON.stringify({ id: manifest.id, sha256: manifest.sha256, status: 'off-vps-receipt-acknowledged', acknowledgedAt: new Date().toISOString() }), { flag: 'wx', mode: 0o600 });
    }
    checks.push({ check: 'backup-transfer', status: 'healthy', reason: 'completed-exports-verified' });
    remote = JSON.parse(execFileSync('ssh', [...ssh, `sudo -n ${operations} --inventory`], { encoding: 'utf8', timeout: 25000, stdio: ['ignore', 'pipe', 'ignore'] }));
    assert.equal(remote.host, 'srv1207055');
    const unhealthy = remote.states.some(item => !item.running || !['healthy', 'running'].includes(item.health) || item.oom);
    const expectedCapture = maintenanceWindow(new Date(now)) && remote.captureInProgress && remote.captureAgeMs < POLICY.intervalMs;
    const suppressed = unhealthy && expectedCapture;
    checks.push({ check: 'vps-services', status: unhealthy ? (suppressed ? 'degraded' : 'failed') : 'healthy',
      reason: suppressed ? 'recorded-backup-window' : unhealthy ? 'service-unhealthy' : 'services-current' });
    checks.push({ check: 'vps-disk', status: remote.diskPercent >= POLICY.diskFailure ? 'failed' : remote.diskPercent >= POLICY.diskWarning ? 'degraded' : 'healthy', reason: `disk-${remote.diskPercent}-percent` });
    checks.push({ check: 'tunnel', status: remote.cloudflared === 'active' ? 'healthy' : 'failed', reason: remote.cloudflared === 'active' ? 'active' : 'inactive' });
    checks.push({ check: 'capture-lock', status: remote.captureInProgress ? (expectedCapture ? 'degraded' : 'failed') : 'healthy',
      reason: remote.captureInProgress ? (expectedCapture ? 'recorded-backup-window' : 'capture-lock-needs-review') : 'no-failed-capture-lock' });
    const serviceKeyDays = (Date.parse(remote.serviceKeyExpiresAt) - now) / 86400000; assert.ok(Number.isFinite(serviceKeyDays));
    checks.push({ check: 'supabase-service-key-expiry', status: serviceKeyDays <= 7 ? 'failed' : serviceKeyDays <= 14 ? 'degraded' : 'healthy',
      reason: serviceKeyDays <= 7 ? 'expires-within-seven-days' : serviceKeyDays <= 14 ? 'expires-within-fourteen-days' : 'key-current' });
    if (expectedCapture) for (const check of checks) {
      if ([new URL(release.appUrl).hostname, new URL(release.apiUrl).hostname].includes(check.check) && check.status === 'unknown') {
        check.status = 'degraded'; check.reason = 'recorded-backup-window';
      }
    }
  } catch { checks.push({ check: 'backup-transfer', status: 'unknown', reason: 'ssh-or-export-verification-unavailable' }); checks.push({ check: 'vps-services', status: 'unknown', reason: 'ssh-or-inventory-unavailable' }); }
  const receipts = [];
  requirePrivate(backupRoot, true);
  for (const id of readdirSync(backupRoot).filter(name => /^staging-\d{8}T\d{6}Z-[a-f0-9]{8}$/.test(name))) {
    validateId(id); requirePrivate(`${backupRoot}/${id}`, true);
    const receiptPath = `${backupRoot}/${id}/receipt.json`; const manifestPath = `${backupRoot}/${id}/manifest.json`;
    if (!existsSync(receiptPath)) continue;
    requirePrivate(receiptPath); requirePrivate(manifestPath);
    const receipt = JSON.parse(readFileSync(receiptPath)); const manifest = JSON.parse(readFileSync(manifestPath));
    validateManifest(manifest, id); assert.equal(receipt.sha256, manifest.sha256); assert.equal(receipt.id, id);
    receipts.push({ ...receipt, createdAt: manifest.createdAt });
  }
  checks.push({ check: 'backup-readiness', ...backupReadiness(receipts, now) });
  const reviewDays = (Date.parse(POLICY.reviewBy) - now) / 86400000;
  checks.push({ check: 'security-review', status: reviewDays <= 0 ? 'failed' : reviewDays <= 7 ? 'degraded' : 'healthy', reason: reviewDays <= 0 ? 'realtime-acceptance-expired' : reviewDays <= 7 ? 'realtime-review-due' : 'review-current' });
  try {
    for (const origin of [release.appUrl, release.apiUrl]) {
      const host = new URL(origin).hostname;
      const expiresAt = await new Promise((resolve, reject) => {
        const socket = connect({ host, servername: host, port: 443, rejectUnauthorized: true }, () => {
          const certificate = socket.getPeerCertificate(); socket.end(); resolve(Date.parse(certificate.valid_to));
        });
        socket.setTimeout(10000, () => { socket.destroy(); reject(new Error('TLS timeout')); }); socket.on('error', reject);
      });
      assert.ok(Number.isFinite(expiresAt)); const days = (expiresAt - now) / 86400000;
      checks.push({ check: `certificate:${host}`, status: days <= 7 ? 'failed' : days <= 14 ? 'degraded' : 'healthy', reason: days <= 7 ? 'expires-within-seven-days' : days <= 14 ? 'expires-within-fourteen-days' : 'certificate-current' });
    }
  } catch { checks.push({ check: 'certificate-expiry', status: 'unknown', reason: 'certificate-check-unavailable' }); }
  const expiryPath = `${stateRoot}/credential-expiry.json`;
  if (existsSync(expiryPath)) {
    requirePrivate(expiryPath); const inventory = JSON.parse(readFileSync(expiryPath));
    assert.equal(inventory.version, 1); assert.ok(Array.isArray(inventory.credentials) && inventory.credentials.length > 0);
    for (const item of inventory.credentials) {
      assert.ok(['cloudflare-access', 'github-app', 'ssh', 'tunnel'].includes(item.name));
      assert.ok(Number.isFinite(Date.parse(item.verifiedAt)) && Date.parse(item.verifiedAt) <= now);
      const days = item.expiresAt === null ? Infinity : (Date.parse(item.expiresAt) - now) / 86400000;
      assert.ok(Number.isFinite(days) || item.expiresAt === null);
      checks.push({ check: `credential:${item.name}`, status: days <= 7 ? 'failed' : days <= 14 ? 'degraded' : 'healthy',
        reason: days <= 7 ? 'expires-within-seven-days' : days <= 14 ? 'expires-within-fourteen-days' : 'expiry-inventory-current' });
    }
    assert.ok(inventory.credentials.some(item => item.name === 'cloudflare-access'));
  } else checks.push({ check: 'credential-expiry', status: 'unknown', reason: 'verified-expiry-inventory-required' });
  const status = { version: 1, checkedAt: new Date(now).toISOString(), checks,
    overall: checks.some(item => item.status === 'failed') ? 'failed' : checks.some(item => item.status === 'unknown') ? 'unknown' : checks.some(item => item.status === 'degraded') ? 'degraded' : 'healthy',
    releaseAllowed: checks.every(item => ['healthy', 'degraded'].includes(item.status) && item.reason !== 'recorded-backup-window'), ...(remote ? { inventory: remote } : {}) };
  const temporary = `${stateRoot}/status.next.json`; writeFileSync(temporary, JSON.stringify(status, null, 2), { flag: 'wx', mode: 0o600 }); renameSync(temporary, previousPath);
  const changes = changedProblems(previous.checks, checks).filter(item => !item.includes('recorded-backup-window'));
  if (existsSync(`${stateRoot}/failure-notified.json`)) {
    requirePrivate(`${stateRoot}/failure-notified.json`); rmSync(`${stateRoot}/failure-notified.json`); changes.push('monitor:recovered');
  }
  if (changes.length) {
    // Optional reputable Homebrew notifier; installation preflight must require
    // this executable before accepting the monitoring schedule.
    try { execFileSync('/opt/homebrew/bin/terminal-notifier', ['-title', 'Barber staging', '-message', changes.join('; ').slice(0, 500), '-group', 'barber-staging'], { stdio: 'ignore', timeout: 10000 }); }
    catch { console.error('Staging status changed; macOS notification delivery unavailable.'); }
  }
  console.log(JSON.stringify({ overall: status.overall, checkedAt: status.checkedAt, changes }));
} catch {
  try {
    requirePrivate(stateRoot, true);
    const marker = `${stateRoot}/failure-notified.json`;
    if (!existsSync(marker)) {
      execFileSync('/opt/homebrew/bin/terminal-notifier', ['-title', 'Barber staging', '-message', 'Staging monitor unavailable. Inspect the private status/log and failure lock.', '-group', 'barber-staging'], { stdio: 'ignore', timeout: 10000 });
      writeFileSync(marker, JSON.stringify({ status: 'monitor-unavailable', at: new Date().toISOString() }), { flag: 'wx', mode: 0o600 });
    }
  } catch { /* Existing logs remain the fallback when notification delivery fails. */ }
  console.error('Staging monitor unavailable; no healthy result claimed.'); process.exitCode = 1;
} finally { if (locked) rmdirSync(`${stateRoot}/running`); }
