import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const shell = (program, ...args) => execFileSync(program, args, { encoding: 'utf8' }).trim();
const sha = input => createHash('sha256').update(input).digest('hex');
const kind = process.argv[2];
const imageRows = shell('docker', 'image', 'ls', '--format', '{{.Repository}} {{.Tag}} {{.ID}}', '--no-trunc')
  .split('\n').filter(line => /^(?:(?:public\.ecr\.aws\/)?supabase\/|supabase\/|nginxinc\/|node )/.test(line)).sort();
const selected = kind === 'application' ? imageRows.filter(line => /^(?:node |nginxinc\/|supabase\/edge-runtime )/.test(line)) : imageRows;
const facts = {
  kind,
  ref: process.env.GITHUB_REF,
  tree: shell('git', 'rev-parse', 'HEAD^{tree}'),
  commit: shell('git', 'rev-parse', 'HEAD'),
  runner: process.env.RUNNER_NAME,
  runnerImage: process.env.ImageVersion,
  kernel: shell('uname', '-srvmo'),
  docker: shell('docker', 'version', '--format', '{{.Server.Version}}'),
  node: process.version,
  npm: shell('npm', '--version'),
  systemPackages: sha(shell('dpkg-query', '-W', '-f=${Package}=${Version}\n').split('\n').sort().join('\n')),
  packageLock: sha(readFileSync('package-lock.json')),
  platformLock: sha(readFileSync('ops/release/runtime-lock.json')),
  workflow: sha(readFileSync('.github/workflows/ci.yml')),
  images: selected,
};
if (!facts.runner || !facts.runnerImage || facts.node !== 'v24.20.0' || selected.length === 0) {
  throw Error('Unable to pin this runner or its inputs');
}
console.log(JSON.stringify({ ...facts, fingerprint: sha(JSON.stringify(facts)) }));
