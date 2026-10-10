import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { backupRoot, requirePrivate, validateManifest } from './pull-staging-backup.mjs';
import { retentionCandidates } from './staging-operations-policy.mjs';

export function pruneMacBackups() {
  assert.equal(process.platform, 'darwin'); requirePrivate(backupRoot, true);
  const records = [];
  for (const id of readdirSync(backupRoot).filter(name => /^staging-\d{8}T\d{6}Z-[a-f0-9]{8}$/.test(name))) {
    const directory = `${backupRoot}/${id}`; requirePrivate(directory, true);
    const names = readdirSync(directory);
    const expected = name => ['manifest.json', 'receipt.json', 'payload.tar.age', 'remote-ack.json', 'pinned.json'].includes(name)
      || /^restore-local-barber-staging-restore-[a-f0-9]{16}\.json$/.test(name);
    if (!names.every(expected) || !names.includes('remote-ack.json') || names.includes('pinned.json')) continue;
    for (const name of names) requirePrivate(`${directory}/${name}`);
    const manifest = JSON.parse(readFileSync(`${directory}/manifest.json`)); validateManifest(manifest, id);
    const receipt = JSON.parse(readFileSync(`${directory}/receipt.json`));
    const acknowledgement = JSON.parse(readFileSync(`${directory}/remote-ack.json`));
    assert.equal(receipt.id, id); assert.equal(receipt.sha256, manifest.sha256);
    assert.equal(acknowledgement.id, id); assert.equal(acknowledgement.sha256, manifest.sha256);
    assert.equal(acknowledgement.status, 'off-vps-receipt-acknowledged');
    const restored = names.filter(name => name.startsWith('restore-local-')).map(name => JSON.parse(readFileSync(`${directory}/${name}`)));
    records.push({ id, createdAt: manifest.createdAt, verified: receipt.status === 'encrypted-transfer-verified', remoteAcknowledged: true,
      restoreVerified: restored.some(item => item.backupId === id && item.temporaryResourcesCleaned === true && item.liveVolumesOverwritten === false), pinned: false });
  }
  const candidates = retentionCandidates(records);
  // All inventories are validated before the first deletion. Fixed validated
  // IDs and private ownership checks prevent broad/path-based deletion.
  for (const id of candidates) { requirePrivate(`${backupRoot}/${id}`, true); rmSync(`${backupRoot}/${id}`, { recursive: true }); }
  return candidates;
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
  try { assert.equal(process.argv.length, 3); assert.equal(process.argv[2], '--prune-reviewed');
    console.log(JSON.stringify({ removed: pruneMacBackups(), recovery: 'Protected recovery points retained; expired copies permanently removed.' }));
  } catch { console.error('Mac backup retention rejected; inspect private evidence.'); process.exitCode = 1; }
}
