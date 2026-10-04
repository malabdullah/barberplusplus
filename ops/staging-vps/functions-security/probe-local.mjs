import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { localDockerProbe } from '../../../scripts/local-docker-probe.mjs';
const docker = localDockerProbe();
const image = process.argv[2];
assert.equal(process.argv.length, 3);
assert.match(image || '', /^sha256:[a-f0-9]{64}$/);
const [metadata] = JSON.parse(docker(['image', 'inspect', '--platform', 'linux/amd64', image]));
assert.equal(metadata.Config?.Labels?.['cloud.malabdullah.barber.candidate'], 'edge-runtime-security-local-only');
assert.equal(`${metadata.Os}/${metadata.Architecture}`, 'linux/amd64');
assert.equal(metadata.Config.User, '10001:10001');
const directory = mkdtempSync('/private/tmp/barber-edge-probe.');
const name = `barber-edge-probe-${randomUUID()}`;
const label = `barber.edge.probe=${randomUUID()}`;
const clean = () => {
  if (docker(['ps', '-aq', '--filter', `name=^/${name}$`, '--filter', `label=${label}`])) docker(['rm', '-f', name]);
};
const profile = ['--name', name, '--label', label, '--platform', 'linux/amd64', '--network', 'none',
  '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--memory', '1g', '--cpus', '1',
  '--pids-limit', '256', '--tmpfs', '/tmp:rw,nosuid,nodev,noexec,size=128m,mode=1777'];
function run(extra, args) {
  try { return docker(['run', '--rm', ...profile, ...extra, image, ...args], { timeout: 90000 }); }
  finally { clean(); }
}
const version = run([], ['--version']);
assert.match(version, /deno 2\.1\.4/);
const help = run([], ['--help']);
assert.match(help, /bundle/);
const linkage = {};
for (const binary of ['/usr/local/bin/edge-runtime', '/usr/lib/libonnxruntime.so']) {
  const output = run(['--entrypoint', '/lib64/ld-linux-x86-64.so.2'], ['--list', binary]);
  assert.ok(!output.includes('not found'));
  linkage[binary] = output;
}
let binarySha256;
const nativeHashes = {};
try {
  docker(['create', ...profile, image, '--help']);
  docker(['cp', `${name}:/usr/local/bin/edge-runtime`, `${directory}/edge-runtime`], { timeout: 90000 });
  binarySha256 = createHash('sha256').update(readFileSync(`${directory}/edge-runtime`)).digest('hex');
  assert.equal(binarySha256, '7883510fe308b4b5c49ec0a8e2020ec81c5fa41133239f3969a372b1cbf107ba');
  docker(['cp', `${name}:/usr/local/share/barber-edge-evidence/upstream.sha256`, `${directory}/upstream.sha256`]);
  const manifest = readFileSync(`${directory}/upstream.sha256`, 'utf8').trim().split('\n').map(line => {
    const match = /^([a-f0-9]{64})  (\/[^\s]+)$/.exec(line);
    assert.ok(match);
    return [match[2], match[1]];
  });
  const paths = ['/usr/local/bin/edge-runtime', '/usr/lib/libonnxruntime.so',
    '/usr/lib/libonnxruntime.so.1', '/usr/lib/libonnxruntime.so.1.20.1'];
  assert.deepEqual(manifest.map(([path]) => path).sort(), [...paths].sort());
  for (const [path, expected] of manifest) {
    const file = `${directory}/${path.split('/').at(-1)}`;
    if (path !== '/usr/local/bin/edge-runtime') docker(['cp', `${name}:${path}`, file], { timeout: 90000 });
    nativeHashes[path] = createHash('sha256').update(readFileSync(file)).digest('hex');
    assert.equal(nativeHashes[path], expected);
  }
} finally { clean(); }
const result = { image, platformId: metadata.Id, directory, binarySha256, nativeHashes, version, linkage,
  authorizing: false, workersTested: false };
writeFileSync(`${directory}/evidence.json`, JSON.stringify(result, null, 2), { mode: 0o600 });
console.log(JSON.stringify(result, null, 2));
