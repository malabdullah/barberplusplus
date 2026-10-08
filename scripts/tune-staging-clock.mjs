// Owner-approved one-time staging prerequisite change. No release/deployment.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { constants, lstatSync, readFileSync, writeFileSync, mkdtempSync, renameSync, openSync, fsyncSync, closeSync, chmodSync } from 'node:fs';
import { hostname } from 'node:os';
import { pathToFileURL } from 'node:url';

const beforeSha256 = '90ed2118d622b9a0488b46405b571575a3955a65cb56a9d3d8b8c1e196ba5d68';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function tuneClockConfig(before) {
  assert.equal(hash(before), beforeSha256, 'Unexpected existing clock configuration');
  const expected = [
    'pool ntp.ubuntu.com        iburst maxsources 4',
    'pool 0.ubuntu.pool.ntp.org iburst maxsources 1',
    'pool 1.ubuntu.pool.ntp.org iburst maxsources 1',
    'pool 2.ubuntu.pool.ntp.org iburst maxsources 2',
  ];
  const lines = before.toString('utf8').split('\n');
  assert.deepEqual(lines.filter(line => /^pool\s/.test(line)), expected);
  // 2^6 = 64 seconds: Chrony's default minimum for public Internet sources.
  return Buffer.from(lines.map(line => expected.includes(line) ? `${line} maxpoll 6` : line).join('\n'));
}

function run() {
  let phase = 'preflight';
  let receiptDirectory;
  try {
    assert.equal(hostname(), 'srv1207055'); assert.equal(process.getuid(), 0);
    assert.equal(process.argv.length, 2);
    const path = '/etc/chrony/chrony.conf';
    const parent = lstatSync('/etc/chrony');
    assert.ok(parent.isDirectory() && parent.uid === 0 && (parent.mode & 0o022) === 0);
    const stat = lstatSync(path);
    assert.ok(stat.isFile() && stat.uid === 0 && stat.gid === 0 && stat.nlink === 1 && (stat.mode & 0o777) === 0o644);
    const before = readFileSync(path);
    const after = tuneClockConfig(before);
    const exec = (binary, args) => execFileSync(binary, args, { encoding: 'utf8', timeout: 30000, maxBuffer: 256 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    assert.equal(exec('/usr/bin/systemctl', ['is-active', 'chrony.service']).trim(), 'active');
    const tracking = exec('/usr/bin/chronyc', ['tracking']);
    assert.match(tracking, /Leap status\s*:\s*Normal/);
    const offset = tracking.match(/System time\s*:\s*([\d.]+) seconds/);
    assert.ok(offset && Number(offset[1]) < 0.1); // No deliberate time step.
    receiptDirectory = mkdtempSync('/root/barber-staging-clock-tuning.');
    const save = (name, bytes) => {
      const file = `${receiptDirectory}/${name}`;
      writeFileSync(file, bytes, { flag: 'wx', mode: 0o600 });
      const fd = openSync(file, constants.O_RDONLY); fsyncSync(fd); closeSync(fd);
    };
    save('chrony.conf.before', before); save('chrony.conf.after', after);
    const receiptDir = openSync(receiptDirectory, constants.O_RDONLY); fsyncSync(receiptDir); closeSync(receiptDir);
    // Ubuntu's AppArmor policy permits Chrony config under /etc/chrony, not
    // /root. Validate a new, root-owned candidate there without changing policy.
    const candidate = '/etc/chrony/.barber-clock-tuning-20261008.conf';
    writeFileSync(candidate, after, { flag: 'wx', mode: 0o644 });
    chmodSync(candidate, 0o644);
    const fd = openSync(candidate, constants.O_RDONLY); fsyncSync(fd); closeSync(fd);
    phase = 'candidate-validation';
    const expanded = exec('/usr/sbin/chronyd', ['-p', '-f', candidate]);
    const sources = expanded.split('\n').filter(line => /^(pool|server|peer)\s/.test(line));
    assert.equal(sources.length, 4);
    assert.ok(sources.every(line => /\bmaxpoll 6\b/.test(line)));
    phase = 'config-installation';
    assert.equal(hash(readFileSync(path)), beforeSha256);
    renameSync(candidate, path);
    const dir = openSync('/etc/chrony', constants.O_RDONLY); fsyncSync(dir); closeSync(dir);
    phase = 'chrony-restart';
    exec('/usr/bin/systemctl', ['restart', 'chrony.service']);
    assert.equal(exec('/usr/bin/systemctl', ['is-active', 'chrony.service']).trim(), 'active');
    const receipt = { status: 'clock-sampling-config-installed', host: hostname(), changedAt: new Date().toISOString(),
      beforeSha256, afterSha256: hash(after), sourcePoolCount: 4, maximumPollSeconds: 64,
      restartedService: 'chrony.service', clockSynchronizationVerified: false, authorizing: false, deployed: false };
    save('installed.json', `${JSON.stringify(receipt, null, 2)}\n`);
    console.log(JSON.stringify({ ...receipt, receiptDirectory }));
  } catch {
    // Preserve partial state/backups for inspection, never blindly retry.
    console.log(JSON.stringify({ status: 'clock-tuning-stopped', phase, receiptDirectory, authorizing: false }));
    process.exitCode = 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run();
