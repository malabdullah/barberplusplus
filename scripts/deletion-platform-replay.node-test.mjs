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
'5; 0 0 TABLE storage objects supabase_admin']
actual=module.platform_objects_for_replay('\\n'.join(lines))
assert actual=='\\n'.join([lines[1],lines[3],lines[4]])+'\\n'
print('PASS')`], { encoding: 'utf8' });
  assert.equal(result.trim(), 'PASS');
});
