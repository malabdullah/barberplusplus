import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('Apple cleanup pair renewal preserves login/encryption and recovers atomically with mocked signing/runtime', () => {
  execFileSync('python3', ['-B', fileURLToPath(new URL('./apple_cleanup_renewal_test.py', import.meta.url))], { stdio: 'pipe', timeout: 60000 });
});
