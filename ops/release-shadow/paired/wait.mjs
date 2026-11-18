// This barrier only reads artifact metadata for its own Test workflow run.
const kinds = ['application', 'browser', 'database'];
const qualifiers = kinds.map(kind => `qualified-${kind}`);
const names = {
  start: qualifiers,
  fast: [...qualifiers, ...kinds.map(kind => `shadow-${kind}`), 'fresh-dependency', 'fresh-secrets'],
  current: [...qualifiers, ...kinds.map(kind => `repeated-${kind}`), 'fresh-dependency', 'fresh-secrets'],
};
const stage = process.argv[2];
const repo = 'malabdullah/barberplusplus';
const env = process.env;
if (env.GITHUB_ACTIONS !== 'true' || env.GITHUB_REPOSITORY !== repo
    || env.GITHUB_REF !== 'refs/heads/codex/release-paired-test-20261118'
    || env.GITHUB_WORKFLOW !== 'Barber paired Test candidate'
    || !/^\d+$/.test(env.GITHUB_RUN_ID ?? '') || env.GITHUB_RUN_ATTEMPT !== '1' || !names[stage]) {
  throw Error('Not the fixed, first-attempt Test workflow');
}
for (let i = 0; i < 300; i += 1) {
  let result;
  try {
    const response = await fetch(`https://api.github.com/repos/${repo}/actions/runs/${env.GITHUB_RUN_ID}/artifacts?per_page=100`, {
      headers: { Authorization: `Bearer ${env.GH_TOKEN}`, Accept: 'application/vnd.github+json' },
      redirect: 'error', signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 401 || response.status === 403) throw Error('Cannot read Test workflow artifacts');
    if (response.ok) result = await response.json();
  } catch (error) {
    if (error.message === 'Cannot read Test workflow artifacts') throw error;
  }
  if (result?.total_count <= 100) {
    const rows = result.artifacts.filter(item => !item.expired);
    if (names[stage].some(name => rows.filter(row => row.name === name).length > 1)) throw Error('Ambiguous Test evidence');
    if (names[stage].every(name => rows.some(row => row.name === name))) {
      const start = Math.max(...qualifiers.map(name => Date.parse(rows.find(row => row.name === name).created_at)));
      if (!Number.isFinite(start)) throw Error('Missing common start stamp');
      console.log(start);
      process.exit(0);
    }
  }
  await new Promise(resolve => setTimeout(resolve, 5000));
}
throw Error(`Timed out waiting for ${stage} evidence`);
