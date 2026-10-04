import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { localDockerProbe } from '../../../scripts/local-docker-probe.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const builder = 'golang@sha256:cd9a32216aee5667f957a62d13a10032a63fd58e14b3f3d9cc8c2122f501e95e';
const sourceCommit = '4eee58f296d9698a1c2c0ae14d7a0b379c7622d3';
const sourceArchiveHash = 'dd5168b9f0bb294fa1e1d343c23b6bb5f68376f271d97dea897339b28fbd4b8d';
const locks = Object.freeze({
  Dockerfile: '783b5f3b4eaf4d12ad35ce3737f6a8cb8410ecd51ef0597c046bcf2491e819b9',
  'Dockerfile.dockerignore': 'ff0fd3ae08c9bafd55ede8ae289888821a8ee925020a08003896ea2bf32f709f',
  'data_row_test.go': 'b070ebcb8fa6fe901c4030dc622e9fd59e0bba927d8d2a344eabfbda00c868e0',
  'go-dependencies.patch': '4066407b7d035eb17d346055ab74836f8cefd9b75e53ae5d6462cd62ec87dbb2',
  'pgproto3-negative-length.patch': '9962dd283f834dd0237a6cf51bed4eb18b6d22e8422c6218aa4403c398daa3c2',
});
const moduleLocks = Object.freeze({
  'go.mod': '61ba79257f298d088f7c58b66ed90fa751ed77ff448ed2d15f0156e67f67b2e6',
  'go.sum': 'cb17a1e2ae227651d76811249fb03e18c4e9b5318cbc7c1c0aa7c73ee550568f',
});
export function sha256(data) { return createHash('sha256').update(data).digest('hex'); }
export function verifyAssets(directory = here) {
  for (const [name, expected] of Object.entries(locks)) {
    assert.equal(sha256(readFileSync(join(directory, name))), expected, `Unreviewed asset: ${name}`);
  }
}
export function verifyArchive(data) {
  assert.equal(sha256(data), sourceArchiveHash, 'Source archive checksum mismatch');
}
function verifyModuleLocks(source) {
  for (const [name, expected] of Object.entries(moduleLocks)) {
    assert.equal(sha256(readFileSync(join(source, name))), expected, `Dependency lock changed: ${name}`);
  }
}

export function prepare(archive) {
  verifyAssets();
  const archiveBytes = readFileSync(resolve(archive));
  verifyArchive(archiveBytes);
  const docker = localDockerProbe();
  const scratch = mkdtempSync(join(tmpdir(), 'barber-auth-security-'));
  chmodSync(scratch, 0o700);
  const archivePath = join(scratch, 'verified-source.tar.gz');
  writeFileSync(archivePath, archiveBytes, { mode: 0o600, flag: 'wx' });
  const source = join(scratch, 'source');
  mkdirSync(source, { mode: 0o700 });
  const run = (command, args) => execFileSync(command, args, {
    encoding: 'utf8', timeout: 30000, env: { PATH: process.env.PATH, HOME: process.env.HOME },
  });
  const prefix = `auth-${sourceCommit}/`;
  const entries = run('tar', ['-tzf', archivePath]).trim().split('\n');
  assert.ok(entries.every((entry) => entry.startsWith(prefix) && !entry.split('/').includes('..')), 'Unsafe source archive entry');
  run('tar', ['-xzf', archivePath, '--strip-components=1', '-C', source]);
  const patch = (name) => {
    run('git', ['-C', source, 'apply', '--check', join(here, name)]);
    run('git', ['-C', source, 'apply', join(here, name)]);
  };
  patch('go-dependencies.patch');
  verifyModuleLocks(source);
  const args = ['run', '--rm', '--platform', 'linux/amd64', '--cpus', '2', '--memory', '3g',
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '-e', 'GOTOOLCHAIN=local'];
  docker([...args, '-v', `${source}:/src`, '-w', '/src', builder, 'sh', '-c',
    'go mod download && go mod verify && go mod vendor'], { timeout: 900000 });
  verifyModuleLocks(source);
  const decoder = join(source, 'vendor/github.com/jackc/pgproto3/v2/data_row.go');
  assert.equal(sha256(readFileSync(decoder)), '6cf3e036a8ac399d981060253720d5fbb0cd026d1fb1808540cd6dfc9771aa4c');
  mkdirSync(join(source, 'internal/authremediation'));
  copyFileSync(join(here, 'data_row_test.go'), join(source, 'internal/authremediation/data_row_test.go'));
  let failedAsExpected = false;
  try {
    docker([...args, '--network', 'none', '-e', 'GOPROXY=off', '-e', 'CGO_ENABLED=0',
      '-v', `${source}:/src:ro`, '-w', '/src', builder, 'go', 'test', '-mod=vendor', '-p=2',
      './internal/authremediation', '-run', 'TestRejectNegativeLengths', '-count=1'], { timeout: 600000 });
  } catch (error) {
    const output = `${error.stdout || ''}${error.stderr || ''}`;
    writeFileSync(join(scratch, 'baseline-test.log'), output);
    failedAsExpected = output.includes('decoder panic:') && output.includes('FAIL');
    if (!failedAsExpected) throw error;
  }
  assert.ok(failedAsExpected, 'Vulnerable baseline did not fail as expected');
  patch('pgproto3-negative-length.patch');
  assert.equal(sha256(readFileSync(decoder)), 'c9deb828e74f5bc7396df0861ee493026aa994dbc58796fd927342ffa6b4a853');
  copyFileSync(join(here, 'Dockerfile'), join(source, 'AuthCandidate.Dockerfile'));
  copyFileSync(join(here, 'Dockerfile.dockerignore'), join(source, 'AuthCandidate.Dockerfile.dockerignore'));
  writeFileSync(join(scratch, 'inputs.json'), JSON.stringify({ sourceCommit, sourceArchiveHash, builder, locks, moduleLocks }, null, 2));
  console.log(JSON.stringify({ scratch, source, status: 'prepared-only-not-built-or-accepted' }));
  return source;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  assert.equal(process.argv.length, 3, 'Usage: node prepare.mjs /absolute/path/to/verified-source.tar.gz');
  prepare(process.argv[2]);
}
