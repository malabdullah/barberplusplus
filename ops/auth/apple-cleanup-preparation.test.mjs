import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('Initial cleanup configuration and selected-file recovery are bounded, default-off and synthetic-only', () => {
  execFileSync('python3', ['-B', fileURLToPath(new URL('./apple_cleanup_preparation_test.py', import.meta.url))], { stdio: 'pipe', timeout: 60000 });
});
