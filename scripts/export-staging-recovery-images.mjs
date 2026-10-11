import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync, statfsSync, lstatSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localDockerProbe } from './local-docker-probe.mjs';
import { inspectPlatformImage } from './staging-postgres-candidate.mjs';
import { assertArchiveConfig } from './staging-image-archive-config.mjs';
import { IMAGES } from './staging-private-model.mjs';
import { manualFirstRelease as release } from './staging-manual-first-release.mjs';
import { requirePrivate, keyRoot } from './pull-staging-backup.mjs';
import { STAGING_TAR_IMAGE } from './staging-backup-tool.mjs';

export const recoveryImages = Object.freeze({ ...IMAGES, functions: release.functions, frontend: release.frontend,
  archiveTool: STAGING_TAR_IMAGE });
export const imageRoot = '/Users/malabdullah/BarberBackups/staging-images';
const aliases = { auth: 'sha256:add5d67a982f17b36538b37ac316095bc5b6ddb9549207ca4e764aadb8307755',
  storage: 'sha256:05ca80acbbe1fa533ca946fcd9aabbbea8065b86bfd1446e8350650ae1e6ea46',
  realtime: 'barber-realtime:os-patch-probe-20261004' };
export async function fileHash(path) {
  const hash = createHash('sha256'); for await (const chunk of createReadStream(path)) hash.update(chunk); return hash.digest('hex');
}
export async function exportImages() {
  assert.equal(process.platform, 'darwin'); requirePrivate('/Users/malabdullah/BarberBackups', true); requirePrivate(keyRoot, true);
  requirePrivate(`${keyRoot}/recipient.txt`); requirePrivate(`${keyRoot}/identity.txt`);
  if (!existsSync(imageRoot)) mkdirSync(imageRoot, { mode: 0o700 }); requirePrivate(imageRoot, true);
  const docker = localDockerProbe(); const inventory = []; const unavailable = [];
  for (const [service, reference] of Object.entries(recoveryImages)) {
    try {
    let source = reference; let image;
    try { image = inspectPlatformImage(docker, source, 'linux/amd64'); }
    catch { assert.ok(aliases[service], 'Recorded artifact unavailable'); source = aliases[service]; image = inspectPlatformImage(docker, source, 'linux/amd64'); }
    if (!reference.includes('@')) assert.equal(image.Id, reference, 'Alias does not identify the exact reviewed platform');
    const parent = JSON.parse(docker(['image', 'inspect', source]))[0];
    assert.equal(image.Os, 'linux'); assert.equal(image.Architecture, 'amd64'); assert.match(image.Id, /^sha256:[a-f0-9]{64}$/);
    if (reference.includes('@')) {
      const [repository, digest] = reference.split('@');
      assert.ok(image.RepoDigests.includes(repository.replace(/:[^/:]+$/, '') + '@' + digest));
    }
    const id = image.Id.slice(7); const directory = `${imageRoot}/${id}`;
    if (existsSync(directory)) {
      requirePrivate(directory, true); requirePrivate(`${directory}/receipt.json`); requirePrivate(`${directory}/image.tar.age`);
      const receipt = JSON.parse(readFileSync(`${directory}/receipt.json`)); assert.equal(receipt.imageId, image.Id);
      assert.equal(await fileHash(`${directory}/image.tar.age`), receipt.sha256);
      execFileSync('age', ['-d', '-i', `${keyRoot}/identity.txt`, `${directory}/image.tar.age`], { stdio: 'ignore', timeout: 600000 });
      inventory.push({ service, reference, ...receipt }); continue;
    }
    const disk = statfsSync(imageRoot); assert.ok(disk.bavail * disk.bsize > image.Size * 2 + 2 * 1024 ** 3);
    const scratch = mkdtempSync(join(tmpdir(), 'barber-recovery-image-'));
    let stage;
    try {
      const archive = join(scratch, 'image.tar');
      // Save by immutable configuration ID; this avoids overwriting unrelated
      // user tags when imported into a recovery daemon.
      docker(['image', 'save', '--platform', 'linux/amd64', '--output', archive, parent.Id], { timeout: 600000 });
      const inner = JSON.parse(execFileSync('/usr/bin/tar', ['-xOf', archive, 'manifest.json'], { encoding: 'utf8', maxBuffer: 65536 }));
      assert.equal(inner.length, 1); assert.deepEqual(inner[0].RepoTags || [], []);
      const configuration = execFileSync('/usr/bin/tar', ['-xOf', archive, inner[0].Config], { maxBuffer: 1048576 });
      const configId = 'sha256:' + createHash('sha256').update(configuration).digest('hex');
      const savedConfig = JSON.parse(configuration);
      assert.equal(savedConfig.architecture, 'amd64'); assert.equal(savedConfig.os, 'linux');
      assertArchiveConfig(savedConfig.config, image.Config);
      assert.deepEqual(savedConfig.rootfs.diff_ids, image.RootFS.Layers);
      stage = `${imageRoot}/.partial-${id}-${randomUUID()}`; mkdirSync(stage, { mode: 0o700 });
      execFileSync('age', ['-R', `${keyRoot}/recipient.txt`, '-o', `${stage}/image.tar.age`, archive], { stdio: 'ignore', timeout: 600000 });
      const file = `${stage}/image.tar.age`; chmodSync(file, 0o600); requirePrivate(file);
      execFileSync('age', ['-d', '-i', `${keyRoot}/identity.txt`, file], { stdio: 'ignore', timeout: 600000 });
      const receipt = { version: 1, imageId: image.Id, configId, sourceReference: reference, platform: 'linux/amd64',
        sha256: await fileHash(file), bytes: lstatSync(file).size, verifiedAt: new Date().toISOString(), status: 'image-export-authenticated' };
      writeFileSync(`${stage}/receipt.json`, JSON.stringify(receipt), { flag: 'wx', mode: 0o600 });
      // Rename publishes the already complete protected directory.
      const { renameSync } = await import('node:fs'); renameSync(stage, directory);
      inventory.push({ service, reference, ...receipt });
    } finally { rmSync(scratch, { recursive: true }); }
    } catch {
      unavailable.push({ service, reference, reason: 'exact-artifact-not-exported' });
      console.error(JSON.stringify({ service, status: 'recovery-export-unavailable' }));
    }
  }
  if (existsSync(`${imageRoot}/inventory.json`)) requirePrivate(`${imageRoot}/inventory.json`);
  writeFileSync(`${imageRoot}/inventory.json`, JSON.stringify({ version: 1, commit: release.commit,
    createdAt: new Date().toISOString(), images: inventory, unavailable, complete: unavailable.length === 0, liveVpsRevalidated: false }, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ status: unavailable.length ? 'recovery-image-set-incomplete' : 'recorded-release-images-exported',
    count: inventory.length, unavailable, liveVpsRevalidated: false }));
  if (unavailable.length) process.exitCode = 1;
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
  try { assert.equal(process.argv.length, 2); await exportImages(); }
  catch (error) {
    console.error('Recovery image export incomplete; existing images and exports preserved.');
    const location = String(error?.stack || '').match(/export-staging-recovery-images\.mjs:(\d+):(\d+)/);
    if (location) console.error(`Exporter check location ${location[1]}:${location[2]}.`);
    process.exitCode = 1;
  }
}
