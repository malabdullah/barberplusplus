import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync, statfsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { localDockerProbe } from './local-docker-probe.mjs';
import { requirePrivate, keyRoot } from './pull-staging-backup.mjs';
import { recoveryImages, imageRoot, fileHash } from './export-staging-recovery-images.mjs';
import { assertArchiveConfig } from './staging-image-archive-config.mjs';
import { inspectPlatformImage } from './staging-postgres-candidate.mjs';

export async function importRecoveryImages(docker = localDockerProbe()) {
  assert.equal(process.platform, 'darwin'); requirePrivate(imageRoot, true); requirePrivate(`${imageRoot}/inventory.json`);
  const inventory = JSON.parse(readFileSync(`${imageRoot}/inventory.json`));
  assert.equal(inventory.version, 1); assert.equal(inventory.images.length, Object.keys(recoveryImages).length);
  const mapping = {};
  for (const [service, reference] of Object.entries(recoveryImages)) {
    const record = inventory.images.find(item => item.service === service && item.reference === reference); assert.ok(record);
    assert.match(record.imageId, /^sha256:[a-f0-9]{64}$/); const directory = `${imageRoot}/${record.imageId.slice(7)}`;
    requirePrivate(directory, true); requirePrivate(`${directory}/receipt.json`); requirePrivate(`${directory}/image.tar.age`);
    const receipt = JSON.parse(readFileSync(`${directory}/receipt.json`));
    assert.equal(receipt.imageId, record.imageId); assert.equal(receipt.sha256, record.sha256);
    assert.match(record.configId, /^sha256:[a-f0-9]{64}$/);
    assert.equal(await fileHash(`${directory}/image.tar.age`), record.sha256);
    const scratch = mkdtempSync(join(tmpdir(), 'barber-recovery-import-'));
    try {
      const disk = statfsSync(scratch); assert.ok(disk.bavail * disk.bsize > record.bytes + 2 * 1024 ** 3);
      const archive = join(scratch, 'image.tar');
      execFileSync('age', ['-d', '-i', `${keyRoot}/identity.txt`, '-o', archive, `${directory}/image.tar.age`], { stdio: 'ignore', timeout: 600000 });
      const manifest = JSON.parse(execFileSync('/usr/bin/tar', ['-xOf', archive, 'manifest.json'], { encoding: 'utf8', maxBuffer: 65536 }));
      assert.equal(manifest.length, 1); assert.deepEqual(manifest[0].RepoTags || [], []);
      const config = execFileSync('/usr/bin/tar', ['-xOf', archive, manifest[0].Config], { maxBuffer: 1048576 });
      assert.equal('sha256:' + createHash('sha256').update(config).digest('hex'), record.configId);
      // An authenticated exact export is imported by ID, without changing tags.
      const loaded = docker(['image', 'load', '--input', archive], { timeout: 600000 });
      const identifiers = [...loaded.matchAll(/^Loaded image ID: (sha256:[a-f0-9]{64})$/gm)];
      assert.equal(identifiers.length, 1, 'Expected one immutable, tagless image import');
      const source = identifiers[0][1];
      // Docker's containerd store addresses the loaded OCI descriptor rather
      // than its configuration blob. Verify the platform manifest and runtime
      // bytes instead of assuming the config digest is daemon-addressable.
      const image = inspectPlatformImage(docker, source, 'linux/amd64');
      assert.equal(image.Id, record.imageId);
      assert.equal(image.Architecture, 'amd64'); assert.equal(image.Os, 'linux');
      assertArchiveConfig(JSON.parse(config).config, image.Config);
      assert.deepEqual(JSON.parse(config).rootfs.diff_ids, image.RootFS.Layers);
      mapping[reference] = source;
    } finally { rmSync(scratch, { recursive: true }); }
  }
  return mapping;
}
