import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('Apple credential renewal verifies signatures, preserves settings and recovers failed/interrupted updates', () => {
  execFileSync('python3', ['-B', fileURLToPath(new URL('./apple_renewal_test.py', import.meta.url))], { stdio: 'pipe', timeout: 60000 });
});
