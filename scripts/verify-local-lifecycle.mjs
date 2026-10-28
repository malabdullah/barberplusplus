import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { localDockerProbe } from './local-docker-probe.mjs';

// Explicit acceptance command: resets only the dedicated disposable Test profile.
const docker = localDockerProbe();
const name = 'supabase_db_barber-local-test';
const owner = JSON.parse(docker(['inspect', name]))[0];
assert.equal(owner.Config.Labels['com.supabase.cli.project'], 'barber-local-test');
function query(text) {
  return docker(['exec', '-i', name, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'supabase_admin', '-d', 'postgres'], { input: text });
}
function local(action) {
  execFileSync(process.execPath, ['scripts/local-test.mjs', action], { stdio: 'pipe', timeout: 300000 });
}
query("CREATE TABLE private.barber_lifecycle_probe(value text); INSERT INTO private.barber_lifecycle_probe VALUES ('synthetic-persistence-marker');");
local('stop');
local('setup');
assert.equal(query('SELECT value FROM private.barber_lifecycle_probe;'), 'synthetic-persistence-marker');
local('reset');
assert.equal(query("SELECT to_regclass('private.barber_lifecycle_probe') IS NULL;"), 't');
const counts = JSON.parse(query("SELECT json_build_object('users',(SELECT count(*) FROM auth.users),'bookings',(SELECT count(*) FROM public.bookings),'activeCron',(SELECT count(*) FROM cron.job WHERE active));"));
assert.deepEqual(counts, { users: 5, bookings: 1, activeCron: 0 });
console.log('LOCAL_LIFECYCLE_PASS: stop/start preserved a stored marker; explicit reset removed it and restored the synthetic baseline');
