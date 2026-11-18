// Creates a Test receipt only; no registry, deploy API or production manifest.
import { createHash } from 'node:crypto';
import { createReadStream, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const sha = input => createHash('sha256').update(input).digest('hex');
const [path, started, output] = process.argv.slice(2);
if (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_WORKFLOW !== 'Barber paired Test candidate'
    || process.env.GITHUB_REF !== 'refs/heads/codex/release-paired-test-20261118'
    || !['fast', 'current'].includes(path)) throw Error('Not a Test package run');
const fixture = readFileSync('ops/release-shadow/paired/fixture.json');
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (commit !== process.env.GITHUB_SHA) throw Error('Candidate changed');
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8' }).trim();
const image = docker('image', 'inspect', '--format', '{{.Id}}', 'barber-production:local-check');
if (!/^sha256:[a-f0-9]{64}$/.test(image)) throw Error('Unbound Test image');
const container = docker('create', image);
try {
  docker('cp', `${container}:/usr/share/nginx/html`, 'dist');
} finally {
  docker('rm', container);
}
const files = [];
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(file);
    else if (entry.isFile()) files.push([file, sha(readFileSync(file))]);
    else throw Error('Unexpected output file type');
  }
}
walk('dist');
if (!files.some(([name]) => name === 'dist/index.html')) throw Error('Missing candidate build');
// The real backend archive exceeds execFileSync's default stdout limit.
const scratch = mkdtempSync(join(tmpdir(), 'barber-pilot-archive-'));
const backendHash = createHash('sha256');
try {
  const archive = join(scratch, 'backend.tar');
  execFileSync('git', ['archive', '--format=tar', `--output=${archive}`, commit, '--',
    'supabase/functions', 'supabase/migrations', 'supabase/schema.expected.sql']);
  for await (const chunk of createReadStream(archive)) backendHash.update(chunk);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
writeFileSync(output, JSON.stringify({ path, commit, image, fixture: sha(fixture),
  frontend: sha(JSON.stringify(files)), files: files.length, backendSource: backendHash.digest('hex'),
  startMs: Number(started), endMs: Date.now() }) + '\n');
