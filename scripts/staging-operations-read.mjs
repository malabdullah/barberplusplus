// Root-owned, fixed-purpose staging inventory/export/receipt interface.
import assert from 'node:assert/strict';
import { existsSync, lstatSync, readFileSync, readdirSync, writeFileSync, rmSync, statfsSync } from 'node:fs';
import { hostname } from 'node:os';
import { execFileSync } from 'node:child_process';
import { liveContext, privateRoot } from './staging-live-context.mjs';
import { validateId, validateManifest } from './pull-staging-backup.mjs';
import { retentionCandidates } from './staging-operations-policy.mjs';
import { INSTALL_ROOT } from './staging-private-model.mjs';

const root = '/var/backups/barber-staging/export';
function readPrivate(path) {
  const stat = lstatSync(path); assert.ok(!stat.isSymbolicLink() && stat.isFile() && stat.uid === 0 && (stat.mode & 0o077) === 0 && stat.size < 65536);
  return JSON.parse(readFileSync(path));
}
function exportsInventory() {
  privateRoot(root);
  return readdirSync(root).filter(id => /^staging-\d{8}T\d{6}Z-[a-f0-9]{8}$/.test(id)).map(id => {
    privateRoot(`${root}/${id}`);
    if (!existsSync(`${root}/${id}/manifest.json`)) return { id, status: 'incomplete' };
    const manifest = readPrivate(`${root}/${id}/manifest.json`); validateManifest(manifest, id);
    const payload = lstatSync(`${root}/${id}/payload.tar.age`);
    assert.ok(payload.isFile() && !payload.isSymbolicLink() && payload.uid === 0 && (payload.mode & 0o077) === 0 && payload.size === manifest.bytes);
    const receipt = existsSync(`${root}/${id}/off-vps-receipt.json`) ? readPrivate(`${root}/${id}/off-vps-receipt.json`) : null;
    const matched = receipt && receipt.id === id && receipt.sha256 === manifest.sha256 && receipt.status === 'encrypted-transfer-verified';
    const restorePath = `${INSTALL_ROOT}/restore-${id}.json`;
    const restore = existsSync(restorePath) ? readPrivate(restorePath) : null;
    return { ...manifest, status: 'complete', verified: Boolean(matched), remoteAcknowledged: Boolean(matched),
      restoreVerified: Boolean(restore?.backupId === id && restore.temporaryResourcesCleaned && restore.liveVolumesOverwritten === false),
      pinned: existsSync(`${root}/${id}/pinned.json`),
      ...(existsSync(`${root}/${id}/capture.json`) ? { capture: readPrivate(`${root}/${id}/capture.json`) } : {}) };
  });
}
try {
  assert.equal(hostname(), 'srv1207055'); assert.equal(process.getuid(), 0);
  const [operation, id] = process.argv.slice(2);
  assert.ok(['--inventory', '--exports', '--ack', '--prune'].includes(operation));
  assert.equal(process.argv.length, operation === '--ack' ? 4 : 3);
  if (operation === '--inventory') {
    const context = liveContext({ health: false });
    const states = context.states.map(item => {
      const [state] = JSON.parse(context.docker(['inspect', item.id]));
      return { name: item.name, image: item.image, running: state.State.Running,
        health: state.State.Health?.Status || (state.State.Running ? 'running' : 'stopped'), restarts: state.RestartCount, oom: state.State.OOMKilled };
    });
    const disk = statfsSync(root);
    const claims = JSON.parse(Buffer.from(context.backend.services.functions.environment.SUPABASE_SERVICE_ROLE_KEY.split('.')[1], 'base64url'));
    assert.equal(claims.role, 'service_role'); assert.ok(Number.isSafeInteger(claims.exp));
    const active = execFileSync('/usr/bin/systemctl', ['is-active', 'barber-staging-cloudflared.service'], { encoding: 'utf8' }).trim();
    const lock = '/var/backups/barber-staging/capture-in-progress';
    let captureAgeMs = null;
    if (existsSync(lock)) {
      privateRoot(lock); const journal = readPrivate(`${lock}/journal.json`);
      assert.equal(journal.version, 1); assert.ok(Number.isFinite(Date.parse(journal.createdAt)));
      captureAgeMs = Date.now() - Date.parse(journal.createdAt); assert.ok(captureAgeMs >= 0);
    }
    console.log(JSON.stringify({ version: 1, host: 'srv1207055', inspectedAt: new Date().toISOString(), states,
      cloudflared: active, diskPercent: Math.round(100 * (disk.blocks - disk.bavail) / disk.blocks),
      captureInProgress: existsSync(lock), captureAgeMs, serviceKeyExpiresAt: new Date(claims.exp * 1000).toISOString() }));
  } else if (operation === '--exports') console.log(JSON.stringify(exportsInventory()));
  else if (operation === '--ack') {
    validateId(id); assert.ok(id.startsWith('staging-')); privateRoot(`${root}/${id}`);
    const chunks = []; let bytes = 0;
    for await (const chunk of process.stdin) { bytes += chunk.length; assert.ok(bytes <= 16384); chunks.push(chunk); }
    const receipt = JSON.parse(Buffer.concat(chunks));
    assert.deepEqual(Object.keys(receipt).sort(), ['bytes', 'id', 'kind', 'restoreVerified', 'sha256', 'status', 'verifiedAt']);
    const manifest = readPrivate(`${root}/${id}/manifest.json`); validateManifest(manifest, id);
    assert.equal(receipt.status, 'encrypted-transfer-verified'); assert.equal(receipt.kind, 'staging-backup');
    assert.equal(receipt.id, id); assert.equal(receipt.sha256, manifest.sha256); assert.equal(receipt.bytes, manifest.bytes);
    assert.equal(receipt.restoreVerified, false);
    assert.ok(Date.parse(receipt.verifiedAt) >= Date.parse(manifest.createdAt) && Date.parse(receipt.verifiedAt) <= Date.now() + 300000);
    const path = `${root}/${id}/off-vps-receipt.json`;
    if (existsSync(path)) assert.deepEqual(readPrivate(path), receipt);
    else writeFileSync(path, JSON.stringify(receipt), { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ id, acknowledged: true }));
  } else {
    // Pruning is explicit and blocked while a capture/maintenance lock exists.
    assert.equal(existsSync('/var/backups/barber-staging/capture-in-progress'), false);
    const records = exportsInventory(); const candidates = retentionCandidates(records.filter(item => item.status === 'complete'));
    for (const candidate of candidates) {
      privateRoot(`${root}/${candidate}`);
      const names = readdirSync(`${root}/${candidate}`);
      assert.ok(names.every(name => ['manifest.json', 'payload.tar.age', 'capture.json', 'off-vps-receipt.json'].includes(name)));
      // Unknown contents and pin files are never removed.
      rmSync(`${root}/${candidate}`, { recursive: true });
    }
    console.log(JSON.stringify({ removed: candidates, recovery: 'Expired copies removed; protected recovery points retained.' }));
  }
} catch { console.error('Staging operations request rejected or unavailable.'); process.exitCode = 1; }
