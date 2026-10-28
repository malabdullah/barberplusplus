import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

export const REPOSITORY = 'malabdullah/barberplusplus';
export const WORKFLOW = '.github/workflows/release.yml';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const SHA = /^[a-f0-9]{40}$/;
const HASH = /^[a-f0-9]{64}$/;
const IMAGE = /^ghcr\.io\/malabdullah\/barberplusplus(?:-functions)?@sha256:[a-f0-9]{64}$/;

export function migrationTree(root) {
  return readdirSync(resolve(root, 'supabase/migrations')).sort().map(name => {
    if (!/^\d{14}_[a-z0-9_]+\.sql$/.test(name)) throw Error('Invalid migration name');
    return { name, sha256: sha256(readFileSync(resolve(root, 'supabase/migrations', name))) };
  });
}
export function validateManifest(m, expected) {
  if (m?.schemaVersion !== 1 || m.repository !== REPOSITORY || m.ref !== 'refs/heads/main' || m.workflow !== WORKFLOW) throw Error('Release identity mismatch');
  if (!SHA.test(m.commit || '') || m.commit !== expected.commit || String(m.runId) !== String(expected.runId) || Number(m.runAttempt) !== Number(expected.runAttempt)) throw Error('Release source/run mismatch');
  if (!IMAGE.test(m.frontendImage || '') || m.frontendImage.includes('-functions@')) throw Error('Invalid frontend image');
  if (!HASH.test(m.backendSha256 || '') || !HASH.test(m.runtimeLockSha256 || '') || !HASH.test(m.expectedSchemaSha256 || '')) throw Error('Invalid artifact hash');
  if (m.backendFile !== 'backend.tar.gz' || m.compatibility !== 'backward-compatible') throw Error('Unreviewed release compatibility');
  if (!Array.isArray(m.migrations) || m.migrations.length === 0) throw Error('Missing migration tree');
  let previous = '';
  for (const row of m.migrations) {
    if (!/^\d{14}_[a-z0-9_]+\.sql$/.test(row.name || '') || !HASH.test(row.sha256 || '') || row.name <= previous) throw Error('Invalid migration order/hash');
    previous = row.name;
  }
  return m;
}

// Conservative automatic-migration subset. Existing routines, RLS/role changes,
// data rewrites and destructive DDL require the separate reviewed-release path.
// SQL literals/comments are rejected here rather than stripped unsafely.
export function automaticSql(sql) {
  // Deliberately exclude table creation: exposing a new public table needs an
  // explicit RLS/permission review. Expressions, defaults and quoted SQL are
  // excluded rather than attempting to implement a SQL parser here.
  if (/--|\/\*|\$|['"\\]|\b(?:drop|truncate|delete|update|insert|grant|revoke|policy|trigger|function|procedure|do|copy|execute)\b/i.test(sql)) return false;
  const statements = sql.split(';').map(s => s.trim()).filter(Boolean);
  const id = '[a-z_][a-z0-9_]*';
  const index = new RegExp(`^create\\s+(?:unique\\s+)?index\\s+${id}\\s+on\\s+public\\.${id}\\s*\\(\\s*${id}(?:\\s*,\\s*${id})*\\s*\\)$`, 'i');
  const column = new RegExp(`^alter\\s+table\\s+public\\.${id}\\s+add\\s+column\\s+${id}\\s+(?:text|boolean|integer|bigint|uuid|date|jsonb|timestamptz|numeric)\\s*$`, 'i');
  return statements.length > 0 && statements.every(statement =>
    index.test(statement) || column.test(statement)
  );
}
