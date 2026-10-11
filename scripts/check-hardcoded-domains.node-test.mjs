import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

for (const [name, exitCode, expected] of [['match', 0, 1], ['no-match', 1, 0], ['scanner-error', 2, 2], ['missing-scanner', null, 1]]) {
  test(`domain check fails closed for ${name}`, () => {
    const directory = mkdtempSync(join(tmpdir(), 'barber-domain-check-'));
    try {
      if (exitCode !== null) writeFileSync(join(directory, 'rg'), `#!/bin/sh\nexit ${exitCode}\n`, { flag: 'wx', mode: 0o700 });
      const result = spawnSync('/bin/sh', ['scripts/check-hardcoded-domains.sh'], { env: { PATH: directory }, encoding: 'utf8' });
      assert.equal(result.status, expected);
      assert.equal(result.stdout.includes('No hardcoded production domains'), expected === 0);
    } finally { rmSync(directory, { recursive: true }); }
  });
}
