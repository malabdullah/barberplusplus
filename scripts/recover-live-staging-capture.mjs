import assert from 'node:assert/strict';
import { lstatSync, readFileSync, existsSync } from 'node:fs';
import { hostname } from 'node:os';
import { localDockerProbe } from './local-docker-probe.mjs';
import { INSTALL_ROOT, PROJECT, SERVICES } from './staging-private-model.mjs';
import { manualFirstRelease as release } from './staging-manual-first-release.mjs';
import { checksum } from './staging-private-backup-format.mjs';
import { validateLiveModels } from './staging-live-backup-format.mjs';
import { privateRoot, readProtected, resumeStates } from './staging-live-context.mjs';

try {
  assert.equal(hostname(), 'srv1207055'); assert.equal(process.getuid(), 0); assert.equal(process.argv.length, 2);
  const lock = '/var/backups/barber-staging/capture-in-progress';
  if (!existsSync(lock)) process.exit(0);
  privateRoot(lock); const path = `${lock}/journal.json`; const stat = lstatSync(path);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.uid === 0 && (stat.mode & 0o077) === 0 && stat.size < 16384);
  const journal = JSON.parse(readFileSync(path)); assert.equal(journal.version, 1); assert.equal(journal.commit, release.commit);
  const original = JSON.parse(readProtected(`${INSTALL_ROOT}/compose.private.json`));
  const backendBytes = readProtected(`${release.root}/backend.private-origin.json`);
  const frontendBytes = readProtected(`${release.root}/frontend.same-origin.json`);
  assert.equal(checksum(backendBytes), journal.backendSha256); assert.equal(checksum(frontendBytes), journal.frontendSha256);
  const backend = JSON.parse(backendBytes); const frontend = JSON.parse(frontendBytes); validateLiveModels(original, backend, frontend);
  const services = [...Object.values(backend.services), frontend.services.frontend];
  assert.deepEqual(journal.states.map(item => item.name).sort(), [...SERVICES.map(name => `${PROJECT}-${name}`), release.frontendProject].sort());
  for (const state of journal.states) {
    assert.match(state.id, /^[a-f0-9]{64}$/);
    assert.equal(state.image, services.find(service => service.container_name === state.name).image);
  }
  await resumeStates(localDockerProbe(), journal.states);
  console.log('Staging services resumed; capture failure lock retained for review.');
} catch { console.error('Capture recovery rejected or failed; operator action required.'); process.exitCode = 1; }
