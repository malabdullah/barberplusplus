import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

// Refresh is deliberately limited to the unchanged, quarantined private bootstrap.
// Never delete/recreate its existing probe or accept an unknown Vault inventory.
export function selectBackupVaultProbe(mode, sql) {
  assert.ok(['bootstrap', 'refresh-private-bootstrap'].includes(mode));
  const count = sql('SELECT count(*) FROM vault.secrets;');
  if (mode === 'refresh-private-bootstrap') {
    assert.equal(count, '1');
    const probe = sql("SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='bootstrap_recovery_probe';");
    assert.match(probe, /^[a-f0-9]{48}$/);
    return probe;
  }
  assert.equal(count, '0');
  const probe = randomBytes(24).toString('hex');
  sql(`SET log_statement='none'; SET log_min_error_statement='panic'; SELECT vault.create_secret('${probe}', 'bootstrap_recovery_probe');`);
  return probe;
}
