import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function resolveRelease(refs, release) {
  const entries = new Map(refs.trim().split('\n').filter(Boolean).map((line) => {
    const [oid, ref] = line.trim().split(/\s+/);
    return [ref, oid];
  }));
  const ref = `refs/tags/${release}`;
  const commit = entries.get(`${ref}^{}`) || entries.get(ref);
  if (!/^[a-f0-9]{40}$/.test(commit || '')) throw new Error('Release is missing or invalid');
  return commit;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const release = readFileSync('ops/supabase/self-hosted.release', 'utf8').trim();
    const expected = readFileSync('ops/supabase/self-hosted.commit', 'utf8').trim();
    if (!/^self-hosted\/v\d+\.\d+\.\d+$/.test(release)) throw new Error('Invalid release pin');
    const refs = execFileSync('git', ['ls-remote', 'https://github.com/supabase/supabase.git',
      `refs/tags/${release}`, `refs/tags/${release}^{}`], { encoding: 'utf8', timeout: 30000 });
    if (resolveRelease(refs, release) !== expected) throw new Error('Release does not match the pinned source commit');
    console.log(`Verified ${release} source commit ${expected}`);
  } catch (error) {
    console.error(`Supabase pin verification failed: ${error.message}`);
    process.exitCode = 1;
  }
}
