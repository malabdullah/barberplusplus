import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { randomUUID, randomBytes } from 'node:crypto';
import { localDockerProbe } from '../../../scripts/local-docker-probe.mjs';
const docker = localDockerProbe();
const image = process.argv[2];
assert.match(image || '', /^sha256:[a-f0-9]{64}$/);
assert.equal(process.argv.length, 3);
const [metadata] = JSON.parse(docker(['image', 'inspect', '--platform', 'linux/amd64', image]));
assert.equal(metadata.Config?.Labels?.['cloud.malabdullah.barber.candidate'], 'realtime-security-local-only');
assert.equal(metadata.Config?.User, '65534:65534');
assert.equal(`${metadata.Os}/${metadata.Architecture}`, 'linux/amd64');
const directory = mkdtempSync('/private/tmp/barber-realtime-profile-probe.');
const hostArchitecture = docker(['info', '--format', '{{.Architecture}}']);
assert.ok(['arm64', 'aarch64', 'amd64', 'x86_64'].includes(hostArchitecture));
const localEmulationWorkaround = ['arm64', 'aarch64'].includes(hostArchitecture);
const label = `barber.realtime.probe=${randomUUID()}`;
function run(args, options) {
  const name = `barber-realtime-probe-${randomUUID()}`;
  try {
    return docker([args[0], '--name', name, '--label', label, ...args.slice(1)], options);
  } finally {
    // A killed Docker client can leave a running --rm container: remove only
    // this invocation's named-and-labelled container, never broad resources.
    const remaining = docker(['ps', '-aq', '--filter', `name=^/${name}$`, '--filter', `label=${label}`]);
    if (remaining) docker(['rm', '-f', name]);
  }
}
const profile = ['run', '--rm', '--platform', 'linux/amd64', '--network', 'none', '--read-only',
  '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--memory', '1g', '--cpus', '1', '--pids-limit', '256',
  '--tmpfs', '/tmp:rw,nosuid,nodev,noexec,size=64m,mode=1777',
  '--tmpfs', '/app/.pgdelta-cache:rw,nosuid,nodev,exec,size=256m,uid=65534,gid=65534,mode=0700'];
run([...profile, image, '--check-profile']);
function rejects(extra, args = profile) {
  assert.throws(() => run([...args, ...extra, image, '--check-profile']), error => {
    assert.equal(error.status, 78);
    assert.match(String(error.stderr), /Realtime staging security profile rejected configuration/);
    assert.ok(!String(error.stderr).includes('synthetic-blocked-value'));
    return true;
  });
}
for (const name of ['AWS_EXECUTION_ENV', 'AWS_ACCESS_KEY_ID', 'GENERATE_CLUSTER_CERTS',
  'CLUSTER_SECRET_ID', 'ECS_CONTAINER_METADATA_URI_V4', 'ENABLE_ERL_CRASH_DUMP', 'ERL_CRASH_DUMP_S3_SECRET']) {
  rejects(['--env', `${name}=synthetic-blocked-value`]);
}
rejects(['--user', '0:0']);
rejects([], profile.filter(arg => !['--security-opt', 'no-new-privileges'].includes(arg)));
rejects([], profile.filter(arg => arg !== '--read-only'));
rejects(['--cap-add', 'SYS_ADMIN']);
const evidence = run([...profile, '--entrypoint', '/bin/sh', image, '-c', `
set -eu
test "$(id -u)" = 65534
test ! -w /app/run.sh
sha256sum -c /usr/local/share/barber-realtime-evidence/app.sha256 >/dev/null
test -z "$(find /usr /bin /sbin -xdev -type f -perm /6000 -print)"
for tool in aws sudo python3; do ! command -v "$tool"; done
test ! -e /usr/lib/systemd/systemd-homed
perl -e 'exit 0'
! perl -MArchive::Tar -e 1 2>/dev/null
test -z "$(grep -Ev '^(#|[[:space:]]*$)' /etc/fstab)"
test "$(stat -c '%u' /app/run.sh)" = 0
ldd /app/erts-16.4.0.4/bin/beam.smp /app/lib/crypto-5.8.3.2/priv/lib/crypto.so > /tmp/linked.txt
! grep -q 'not found' /tmp/linked.txt
cat /tmp/linked.txt
/app/erts-16.4.0.4/bin/erl -version 2>&1
pgdelta --help >/dev/null
printf 'PROFILE_AND_NATIVE_HELP_PASS\\n'
cat /usr/local/share/barber-realtime-evidence/packages-after.tsv
`], { timeout: 180000 });
assert.match(evidence, /PROFILE_AND_NATIVE_HELP_PASS/);
// OTP's W^X JIT is incompatible with AMD64 user-space emulation on ARM Macs.
// This upstream workaround is LOCAL ONLY; never add it to runtime-profile.yml.
// https://github.com/erlang/otp/issues/10355#issuecomment-3510018425
let releaseEval;
const releaseSecrets = ['RELEASE_COOKIE', 'METRICS_JWT_SECRET', 'SECRET_KEY_BASE', 'API_JWT_SECRET']
  .map(name => [name, randomBytes(32).toString(name === 'RELEASE_COOKIE' ? 'base64url' : 'hex')]);
try {
  releaseEval = run([...profile, '--env', 'DB_HOST=127.0.0.1', '--env', 'DB_IP_VERSION=ipv4', '--env', 'APP_NAME=realtime',
    ...releaseSecrets.flatMap(([name, value]) => ['--env', `${name}=${value}`]),
    '--env', `ERL_AFLAGS=+S 2:2 -proto_dist inet_tcp${localEmulationWorkaround ? ' +JMsingle true' : ''}`,
    '--entrypoint', '/app/bin/realtime', image, 'eval', 'IO.puts("RELEASE_EVAL_PASS")']);
} catch (error) {
  let output = `${error.stdout || ''}\n${error.stderr || ''}`;
  for (const [, value] of releaseSecrets) output = output.replaceAll(value, '[redacted]');
  writeFileSync(`${directory}/release-error.txt`, output, { mode: 0o600 });
  throw new Error(`Full release eval failed; sanitized diagnostic ${directory}/release-error.txt`);
}
assert.match(releaseEval, /RELEASE_EVAL_PASS/);
writeFileSync(`${directory}/evidence.txt`, evidence, { mode: 0o600 });
console.log(JSON.stringify({ image, platformId: metadata.Id, directory, profileChecks: 'passed',
  releaseEval: 'passed', localEmulationWorkaround,
  applicationBoot: 'not tested; database integration and native AMD64 acceptance required', authorizing: false }, null, 2));
