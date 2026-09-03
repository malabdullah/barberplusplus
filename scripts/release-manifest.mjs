import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const migrationNamePattern = /^\d{14}_[a-z0-9_]+\.sql$/;
const commitPattern = /^[0-9a-f]{40}$/;
const digestPattern = /^sha256:[0-9a-f]{64}$/;

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

export async function getMigrationSet(migrationsDir = 'supabase/migrations') {
  const entries = (await readdir(migrationsDir, { withFileTypes: true }))
    .filter((entry) => entry.name.endsWith('.sql'))
    .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);

  if (entries.length === 0) {
    throw new Error('No SQL migrations were found.');
  }

  const migrations = [];
  for (const entry of entries) {
    if (!entry.isFile() || !migrationNamePattern.test(entry.name)) {
      throw new Error(`Migration is not a timestamped regular SQL file: ${entry.name}`);
    }

    const filePath = path.join(migrationsDir, entry.name);
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      throw new Error(`Migration is not a regular file: ${entry.name}`);
    }

    migrations.push({
      name: entry.name,
      sha256: sha256(await readFile(filePath)),
    });
  }

  const tree = migrations.map(({ name, sha256: fileHash }) => `${name}\0${fileHash}\n`).join('');
  return {
    latest_migration: migrations.at(-1).name.replace(/\.sql$/, ''),
    migration_tree_sha256: sha256(tree),
    migrations,
  };
}

export async function createAcceptedRelease({
  commit,
  digest,
  workflowRunId,
  acceptedAt = new Date().toISOString(),
  migrationsDir = 'supabase/migrations',
}) {
  if (!commitPattern.test(commit)) throw new Error('Release commit must be a full lowercase SHA-1.');
  if (!digestPattern.test(digest)) throw new Error('Image digest must be a lowercase sha256 digest.');
  if (!/^\d+$/.test(workflowRunId)) throw new Error('Workflow run ID must be numeric.');
  if (new Date(acceptedAt).toISOString() !== acceptedAt) {
    throw new Error('Acceptance time must be a canonical ISO-8601 UTC timestamp.');
  }

  return {
    schema_version: 1,
    commit,
    digest,
    accepted_at: acceptedAt,
    workflow_run_id: workflowRunId,
    ...await getMigrationSet(migrationsDir),
  };
}

export async function verifyAcceptedRelease(
  manifest,
  expectedCommit,
  migrationsDir = 'supabase/migrations',
  expectedWorkflowRunId,
) {
  if (manifest?.schema_version !== 1) throw new Error('Unsupported accepted-release schema version.');
  if (!commitPattern.test(expectedCommit) || manifest.commit !== expectedCommit) {
    throw new Error('Accepted-release commit does not match the release commit.');
  }
  if (!digestPattern.test(manifest.digest)) throw new Error('Accepted-release digest is invalid.');
  if (!/^\d+$/.test(manifest.workflow_run_id)) throw new Error('Accepted-release workflow run ID is invalid.');
  if (expectedWorkflowRunId !== undefined && manifest.workflow_run_id !== expectedWorkflowRunId) {
    throw new Error('Accepted-release workflow run ID does not match its source workflow.');
  }
  if (new Date(manifest.accepted_at).toISOString() !== manifest.accepted_at) {
    throw new Error('Accepted-release timestamp is invalid.');
  }

  const current = await getMigrationSet(migrationsDir);
  if (manifest.latest_migration !== current.latest_migration
      || manifest.migration_tree_sha256 !== current.migration_tree_sha256
      || JSON.stringify(manifest.migrations) !== JSON.stringify(current.migrations)) {
    throw new Error('Accepted-release migration set does not match the release source.');
  }

  return manifest.digest;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'create' && args.length === 3) {
    const manifest = await createAcceptedRelease({
      commit: args[0],
      digest: args[1],
      workflowRunId: args[2],
    });
    process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
    return;
  }

  if (command === 'verify' && args.length === 3) {
    const manifest = JSON.parse(await readFile(args[0], 'utf8'));
    process.stdout.write(`${await verifyAcceptedRelease(manifest, args[1], 'supabase/migrations', args[2])}\n`);
    return;
  }

  throw new Error('Usage: release-manifest.mjs create <commit> <digest> <run-id> | verify <manifest.json> <commit> <run-id>');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
