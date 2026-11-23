import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

test('platform bootstrap defers application session policy until its migration and preserves unrelated platform objects', () => {
  const result = execFileSync('python3', ['-c', `import importlib.util
spec=importlib.util.spec_from_file_location('replay','ops/release/test-postgres-image.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
lines=['1; 0 0 POLICY storage objects Storage requires a live account session supabase_admin',
'2; 0 0 POLICY storage objects Keep unrelated policy supabase_admin',
'3; 0 0 TRIGGER auth users assign_default_manager_role supabase_admin',
'4; 0 0 TRIGGER auth users Keep platform trigger supabase_admin',
'5; 0 0 TABLE storage objects supabase_admin',
'6; 0 0 TRIGGER auth users discard_unverified_customer_password postgres',
'7; 0 0 TRIGGER auth users discard_unverified_customer_password_other supabase_admin']
actual=module.platform_objects_for_replay('\\n'.join(lines))
assert actual=='\\n'.join([lines[1],lines[3],lines[4],lines[6]])+'\\n'
print('PASS')`], { encoding: 'utf8' });
  assert.equal(result.trim(), 'PASS');
});

test('Android session trigger is replayed only after its migration; other session triggers remain', () => {
  const result = execFileSync('python3', ['-c', `import importlib.util
spec=importlib.util.spec_from_file_location('replay','ops/release/test-postgres-image.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
lines=['1; 0 0 TRIGGER auth sessions android_live_push_session_retire postgres',
'2; 0 0 TRIGGER auth sessions android_live_push_session_retire_other postgres',
'3; 0 0 TRIGGER auth sessions platform_session_hook supabase_admin']
actual=module.platform_objects_for_replay('\\n'.join(lines))
assert actual=='\\n'.join(lines[1:])+'\\n'
print('PASS')`], { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  assert.equal(result.trim(), 'PASS');
});
