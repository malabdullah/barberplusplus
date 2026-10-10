import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { localDockerProbe } from './local-docker-probe.mjs';
import { inspectPlatformImage } from './staging-postgres-candidate.mjs';

const prefix = `barber-tar-probe-${randomBytes(8).toString('hex')}`;
const label = 'cloud.malabdullah.barber.disposable-archive-probe';
const created = []; let docker; let passed = false;
try {
  assert.equal(process.argv.length, 3); assert.match(process.argv[2], /^sha256:[a-f0-9]{64}$/);
  docker = localDockerProbe(); const image = inspectPlatformImage(docker, process.argv[2], 'linux/amd64');
  assert.equal(image.Config.Labels['cloud.malabdullah.barber.candidate'], 'backup-tar-local-only');
  const inventory = () => docker(['ps', '--format', '{{.ID}} {{.Names}} {{.Image}}']).split('\n').filter(Boolean).sort();
  const before = inventory();
  const source = `${prefix}-source`; const target = `${prefix}-target`; const legacyTarget = `${prefix}-legacy-target`;
  for (const volume of [source, target, legacyTarget]) {
    assert.equal(docker(['volume', 'ls', '-q', '--filter', `name=^${volume}$`]), '');
    docker(['volume', 'create', '--label', `${label}=${prefix}`, volume]); created.push(volume);
  }
  const flags = ['--rm', '--platform', 'linux/amd64', '--network', 'none', '--read-only', '--user', '0:0',
    '--cap-drop', 'ALL', '--cap-add', 'CHOWN', '--cap-add', 'FOWNER', '--cap-add', 'DAC_OVERRIDE',
    '--security-opt', 'no-new-privileges', '--memory', '128m', '--cpus', '0.5', '--pids-limit', '32', '--label', `${label}=${prefix}`];
  const mount = (volume, readOnly = false) => `type=volume,src=${volume},dst=/data${readOnly ? ',readonly' : ''}`;
  const setup = 'printf synthetic-tar-only > /data/probe.txt; chown 10001:10001 /data/probe.txt; chmod 640 /data/probe.txt; '
    + 'setfattr -n user.content-type -v text/plain /data/probe.txt; setfattr -n user.cache-control -v max-age=3600 /data/probe.txt; '
    + 'setfattr -n user.etag -v synthetic-etag /data/probe.txt; setfacl -m u:10002:r-- /data/probe.txt';
  docker(['run', ...flags, '--mount', mount(source), '--entrypoint', '/bin/sh', image.Id, '-ec', setup]);
  const snapshot = volume => docker(['run', ...flags, '--mount', mount(volume, true), '--entrypoint', '/bin/sh', image.Id, '-ec',
    'cat /data/probe.txt; stat -c "%u:%g:%a" /data/probe.txt; getfattr -d -m "^user\\." /data/probe.txt 2>/dev/null; getfacl -n /data/probe.txt 2>/dev/null']);
  const expected = snapshot(source);
  const archive = docker(['run', ...flags, '--mount', mount(source, true), '--entrypoint', '/bin/tar', image.Id,
    '--xattrs', '--xattrs-include=user.*', '--acls', '--numeric-owner', '-C', '/data', '-cpf', '-', '.'], { encoding: null, maxBuffer: 1048576 });
  docker(['run', '-i', ...flags, '--mount', mount(target), '--entrypoint', '/bin/tar', image.Id,
    '--xattrs', '--xattrs-include=user.*', '--acls', '--numeric-owner', '-C', '/data', '-xpf', '-'], { input: archive });
  assert.equal(snapshot(target), expected); assert.ok(expected.includes('synthetic-etag') && expected.includes('10002:r--'));
  const legacyImage = 'node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e';
  const oldArchive = docker(['run', ...flags, '--mount', mount(source, true), '--entrypoint', 'tar', legacyImage,
    '--xattrs', '--xattrs-include=user.*', '--acls', '--numeric-owner', '-C', '/data', '-cpf', '-', '.'], { encoding: null, maxBuffer: 1048576 });
  docker(['run', '-i', ...flags, '--mount', mount(legacyTarget), '--entrypoint', '/bin/tar', image.Id,
    '--xattrs', '--xattrs-include=user.*', '--acls', '--numeric-owner', '-C', '/data', '-xpf', '-'], { input: oldArchive });
  assert.equal(snapshot(legacyTarget), expected);
  assert.deepEqual(inventory(), before); passed = true;
  console.log(JSON.stringify({ status: 'archive-metadata-round-trip-passed', image: image.Id,
    checks: ['content', 'numeric ownership', 'mode', 'POSIX ACL', 'content type', 'cache control', 'etag', 'legacy GNU tar compatibility'], existingServicesUnchanged: true }));
} catch { console.error('Archive candidate test failed; no live pin adopted.'); process.exitCode = 1; }
finally {
  for (const volume of created) {
    try { assert.equal(JSON.parse(docker(['volume', 'inspect', volume]))[0].Labels[label], prefix); docker(['volume', 'rm', volume]); }
    catch { console.error(`Disposable archive cleanup requires attention: ${volume}`); process.exitCode = 1; passed = false; }
  }
  if (passed) console.log('Removed only the labelled synthetic archive-test volumes.');
}
