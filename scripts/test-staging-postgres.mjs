// Opt-in, disposable image-contract probe. Not full Supabase/migration acceptance.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { POSTGRES_IMAGE } from './check-vps-compose.mjs';
import { inspectCandidate, inspectPlatformImage } from './staging-postgres-candidate.mjs';

const platform = process.argv[2] || 'linux/amd64';
if (!['linux/amd64', 'linux/arm64'].includes(platform) || process.argv.length > 4) {
  throw new Error('Usage: node scripts/test-staging-postgres.mjs [linux/amd64|linux/arm64] [local-image-id]');
}
const name = `barber-pg-contract-${randomBytes(8).toString('hex')}`;
const label = 'barber.staging.postgres-contract';
const env = {
  ...process.env,
  POSTGRES_PASSWORD: randomBytes(32).toString('hex'),
  JWT_SECRET: randomBytes(32).toString('hex'),
};
let created = false;
let stage = 'image metadata';
const docker = (args, options = {}) => execFileSync('docker', args, {
  encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024,
  stdio: ['pipe', 'pipe', 'pipe'], env, ...options,
});
try {
  const context = docker(['context', 'show']).trim();
  const [contextInfo] = JSON.parse(docker(['context', 'inspect', context]));
  assert.ok(contextInfo.Endpoints.docker.Host.startsWith('unix://'), 'Local Docker only');
  assert.ok(!env.DOCKER_HOST && !env.DOCKER_CONTEXT, 'Docker environment overrides forbidden');
  const imageRef = process.argv[3] ? inspectCandidate(docker, process.argv[3], platform) : POSTGRES_IMAGE;
  // Fail if the exact platform image is not already downloaded. Never pull a tag.
  const image = inspectPlatformImage(docker, imageRef, platform);
  assert.deepEqual(image.Config.Entrypoint, ['docker-entrypoint.sh']);
  stage = 'container creation';
  docker(['create', '--name', name, '--label', `${label}=true`, '--platform', platform,
    '--network', 'none', '--memory', '1g', '--cpus', '1', '--pids-limit', '256',
    '--security-opt', 'no-new-privileges',
    '--tmpfs', '/var/lib/postgresql/data:rw,nosuid,size=512m',
    // Keep packaged /etc/postgresql-custom files in the disposable container
    // layer. An empty tmpfs there masks configuration required for startup.
    '-e', 'POSTGRES_PASSWORD', '-e', 'JWT_SECRET', '-e', 'JWT_EXP=3600',
    '-e', 'POSTGRES_DB=postgres', imageRef,
    'postgres', '-c', 'config_file=/etc/postgresql/postgresql.conf',
    '-c', 'log_min_messages=fatal']);
  created = true;
  stage = 'isolation inspection';
  const [container] = JSON.parse(docker(['inspect', name]));
  assert.equal(container.HostConfig.NetworkMode, 'none');
  assert.equal(container.HostConfig.Privileged, false);
  assert.equal(Object.keys(container.HostConfig.PortBindings || {}).length, 0);
  assert.ok(container.Mounts.every((mount) => mount.Type === 'tmpfs'));
  stage = 'database initialization';
  docker(['start', name]);
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      docker(['exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres']);
      ready = true;
      break;
    } catch {
      if (docker(['inspect', '--format', '{{.State.Running}}', name]).trim() !== 'true') break;
      await setTimeout(1000);
    }
  }
  assert.ok(ready, 'Candidate did not initialize within the bounded readiness window');
  stage = 'gosu privilege-drop contract';
  assert.match(docker(['exec', name, 'gosu', '--version']), /^1\.19 /);
  const postgresUid = docker(['exec', name, 'id', '-u', 'postgres']).trim();
  assert.notEqual(postgresUid, '0');
  assert.equal(docker(['exec', name, 'gosu', 'postgres', 'id', '-u']).trim(), postgresUid);
  assert.equal(docker(['exec', name, 'gosu', '12345:23456', 'id', '-u']).trim(), '12345');
  assert.equal(docker(['exec', name, 'gosu', '12345:23456', 'id', '-g']).trim(), '23456');
  assert.throws(() => docker(['exec', name, 'gosu', 'barber-user-does-not-exist', 'id']));
  assert.throws(() => docker(['exec', '-u', 'postgres', name, 'gosu', 'root', 'id']));
  stage = 'server version query';
  const query = (sql) => docker(['exec', '-i', '-u', 'postgres', name,
    'psql', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-d', 'postgres'], { input: sql }).trim();
  assert.equal(query('SHOW server_version_num;'), '170011');
  stage = 'extension inventory';
  const extensions = query("SELECT name FROM pg_available_extensions WHERE name IN ('pgcrypto','uuid-ossp','pg_net','pg_cron','pgtap','supabase_vault') ORDER BY name;").split('\n');
  assert.deepEqual(extensions, ['pg_cron', 'pg_net', 'pgcrypto', 'pgtap', 'supabase_vault', 'uuid-ossp']);
  stage = 'pgcrypto transaction';
  assert.equal(query('BEGIN; CREATE EXTENSION IF NOT EXISTS pgcrypto; SELECT length(gen_random_bytes(16)); ROLLBACK;'), '16');
  console.log(`PASS: ${platform}, PostgreSQL 17.11 startup, required extension inventory, pgcrypto query; no network, published ports or host mounts.`);
  console.log('Full-stack Auth/Storage migrations, application replay and restore remain separate gates.');
} catch {
  // Never echo docker errors, logs or environment values; they can hold secrets.
  console.error(`Postgres image-contract probe FAILED at ${stage}; no deployment acceptance is granted.`);
  process.exitCode = 1;
} finally {
  if (created) {
    try {
      assert.equal(docker(['inspect', '--format', `{{index .Config.Labels "${label}"}}`, name]).trim(), 'true');
      docker(['rm', '--force', name]);
      console.log('Removed this probe’s disposable container and in-memory database.');
    } catch {
      console.error(`Cleanup needs attention for probe container ${name}; no broad cleanup attempted.`);
      process.exitCode = 1;
    }
  }
  delete env.POSTGRES_PASSWORD;
  delete env.JWT_SECRET;
}
