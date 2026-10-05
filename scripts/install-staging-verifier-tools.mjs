// One-time, specifically owner-approved prerequisite install. No deployment.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = '/var/lib/barber-staging-verifier-prerequisites';
const archiveSha = 'bb766f710eef8ede859c18578c72c327597cd4c8a85b06001b1f3843c6019386';
const packages = ['chrony=4.5-1ubuntu4.2', 'tzdata-legacy=2026c-0ubuntu0.24.04.1'];
const run = (file, args, options = {}) => execFileSync(file, args, {
  encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024,
  stdio: ['pipe', 'pipe', 'pipe'], ...options,
});
let stage = 'preflight';
try {
  assert.equal(hostname(), 'srv1207055'); assert.equal(process.getuid(), 0);
  assert.equal(process.arch, 'x64'); assert.equal(process.argv[2], '--owner-approved');
  assert.equal(process.argv.length, 3);
  assert.ok(!existsSync(root) && !existsSync('/usr/local/bin/gh'));
  for (const path of ['/var/lib', '/usr/local/bin']) {
    const s = lstatSync(path); assert.ok(s.isDirectory() && !s.isSymbolicLink() && s.uid === 0 && !(s.mode & 0o022));
  }
  const before = run('/usr/bin/docker', ['ps', '--format', '{{.ID}} {{.Names}} {{.Image}}']).trim().split('\n').sort();
  const simulation = run('/usr/bin/apt-get', ['-s', 'install', '--no-install-recommends', ...packages]);
  assert.deepEqual([...simulation.matchAll(/^Remv (\S+)/gm)].map((m) => m[1]), ['systemd-timesyncd']);
  assert.deepEqual([...simulation.matchAll(/^Inst (\S+)/gm)].map((m) => m[1]).sort(), ['chrony', 'tzdata-legacy']);
  mkdirSync(root, { mode: 0o700 });
  const save = (name, value) => writeFileSync(join(root, name), value, { flag: 'wx', mode: 0o600 });
  save('approval.txt', 'Approve staging verifier prerequisites\n');
  save('installer.mjs', readFileSync(fileURLToPath(import.meta.url)));
  save('before-containers.json', JSON.stringify(before));
  save('apt-simulation.txt', simulation);
  save('previous-time-service.txt', run('/usr/bin/systemctl', ['show', 'systemd-timesyncd', '-p', 'ActiveState', '-p', 'UnitFileState']));
  for (const name of ['timesyncd.conf', 'timesyncd.conf.d']) {
    const path = `/etc/systemd/${name}`;
    if (existsSync(path)) cpSync(path, join(root, name), { recursive: true, errorOnExist: true, force: false });
  }
  stage = 'official GitHub CLI checksum verification';
  const scratch = mkdtempSync(join(tmpdir(), 'barber-verifier-tools-'));
  const archive = join(scratch, 'gh.tar.gz');
  run('/usr/bin/curl', ['--fail', '--silent', '--show-error', '--location', '--max-time', '120',
    '--max-filesize', '67108864', '--proto', '=https', '--proto-redir', '=https',
    'https://github.com/cli/cli/releases/download/v2.102.0/gh_2.102.0_linux_amd64.tar.gz', '-o', archive], { timeout: 130000 });
  assert.equal(createHash('sha256').update(readFileSync(archive)).digest('hex'), archiveSha);
  const member = 'gh_2.102.0_linux_amd64/bin/gh';
  const listing = run('/usr/bin/tar', ['-tzvf', archive, member]).trim();
  assert.ok(listing.startsWith('-') && !listing.includes('\n'));
  const binary = run('/usr/bin/tar', ['-xzOf', archive, member], { encoding: null, maxBuffer: 128 * 1024 * 1024 });
  writeFileSync('/usr/local/bin/gh', binary, { flag: 'wx', mode: 0o755 });
  chmodSync('/usr/local/bin/gh', 0o755);
  assert.ok(run('/usr/local/bin/gh', ['--version']).startsWith('gh version 2.102.0'));
  const help = run('/usr/local/bin/gh', ['attestation', 'verify', '--help']);
  for (const flag of ['--source-digest', '--signer-digest', '--deny-self-hosted-runners', '--cert-identity']) assert.ok(help.includes(flag));
  stage = 'approved time-service replacement';
  run('/usr/bin/apt-get', ['install', '-y', '--no-install-recommends', ...packages], {
    timeout: 180000, env: { PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      DEBIAN_FRONTEND: 'noninteractive', NEEDRESTART_MODE: 'l', LC_ALL: 'C' },
  });
  assert.equal(run('/usr/bin/systemctl', ['is-active', 'chrony']).trim(), 'active');
  const after = run('/usr/bin/docker', ['ps', '--format', '{{.ID}} {{.Names}} {{.Image}}']).trim().split('\n').sort();
  assert.deepEqual(after, before, 'Existing container identities changed');
  save('installed.json', JSON.stringify({ host: hostname(), at: new Date().toISOString(), ghVersion: '2.102.0',
    archiveSha256: archiveSha, binarySha256: createHash('sha256').update(binary).digest('hex'),
    packages, replacedTimeService: 'systemd-timesyncd', originalContainersUnchanged: true,
    clockAccuracyVerified: false, automationEnabled: false }, null, 2) + '\n');
  console.log('Installed approved verifier prerequisites; existing containers unchanged. Clock accuracy verification remains required.');
} catch {
  console.error(`Verifier prerequisite installation stopped at: ${stage}. Preserve evidence and inspect before any retry.`);
  process.exitCode = 1;
}
