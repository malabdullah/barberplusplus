import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { localDockerProbe } from '../../../scripts/local-docker-probe.mjs';
const docker = localDockerProbe();
const directory = mkdtempSync('/private/tmp/barber-edge-minimal.');
const context = fileURLToPath(new URL('.', import.meta.url));
try {
  docker(['build', '--platform', 'linux/amd64', '--iidfile', `${directory}/image.id`,
    '--file', `${context}Dockerfile`, context], { timeout: 600000, maxBuffer: 16 * 1024 * 1024 });
  const id = readFileSync(`${directory}/image.id`, 'utf8').trim();
  assert.match(id, /^sha256:[a-f0-9]{64}$/);
  const [index] = JSON.parse(docker(['image', 'inspect', id]));
  const [platform] = JSON.parse(docker(['image', 'inspect', '--platform', 'linux/amd64', id]));
  assert.equal(index.Id, id);
  assert.equal(`${platform.Os}/${platform.Architecture}`, 'linux/amd64');
  assert.equal(platform.Config.User, '10001:10001');
  const metadata = { localReference: id, platformId: platform.Id, authorizing: false, directory };
  writeFileSync(`${directory}/metadata.json`, JSON.stringify(metadata, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(metadata, null, 2));
} catch (error) {
  writeFileSync(`${directory}/error.txt`, String(error.stderr || error.message), { mode: 0o600 });
  throw new Error(`Candidate build failed; diagnostic: ${directory}/error.txt`);
}
