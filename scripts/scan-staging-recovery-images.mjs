import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { imageRoot, fileHash } from './export-staging-recovery-images.mjs';
import { requirePrivate, keyRoot } from './pull-staging-backup.mjs';

let scratch; let stage = 'preflight';
try {
  assert.equal(process.platform, 'darwin'); assert.equal(process.argv.length, 2);
  requirePrivate(imageRoot, true); requirePrivate(`${imageRoot}/inventory.json`);
  const inventory = JSON.parse(readFileSync(`${imageRoot}/inventory.json`));
  requirePrivate(`${keyRoot}/identity.txt`);
  scratch = mkdtempSync(join(tmpdir(), 'barber-recorded-image-scans-'));
  const reports = [];
  const scanner = '/private/tmp/barber-image-evidence.RTpGMB/trivy';
  assert.equal(await fileHash(scanner), '0ed07c205ca9ecc1065dc57b9f9f77adc79393bb469d9d1de9ec90c8c94ffc2f');
  assert.match(execFileSync(scanner, ['--version'], { encoding: 'utf8' }), /Version: 0\.74\.0/);
  for (const image of inventory.images) {
    stage = `artifact:${image.service}`;
    assert.match(image.service, /^(db|auth|storage|rest|mailpit|api-gw|functions|realtime|frontend|archiveTool)$/);
    assert.match(image.imageId, /^sha256:[a-f0-9]{64}$/);
    requirePrivate(`${imageRoot}/${image.imageId.slice(7)}`, true);
    const encrypted = `${imageRoot}/${image.imageId.slice(7)}/image.tar.age`; requirePrivate(encrypted);
    assert.equal(await fileHash(encrypted), image.sha256);
    const archive = join(scratch, `${image.service}.tar`);
    execFileSync('age', ['-d', '-i', `${keyRoot}/identity.txt`, '-o', archive, encrypted], { stdio: 'ignore', timeout: 600000 });
    const output = join(scratch, `${image.service}.json`);
    stage = `scanner:${image.service}`;
    execFileSync(scanner, ['image', '--input', archive, '--scanners', 'vuln', '--config', '/dev/null', '--ignorefile', '/dev/null', '--format', 'json', '--output', output],
      { stdio: 'ignore', timeout: 600000, env: { PATH: process.env.PATH, HOME: process.env.HOME } });
    const report = JSON.parse(readFileSync(output));
    const findings = (report.Results || []).flatMap(result => (result.Vulnerabilities || []).map(item => ({
      id: item.VulnerabilityID, package: item.PkgName, installed: item.InstalledVersion, fixed: item.FixedVersion || null,
      severity: item.Severity, source: item.PrimaryURL || null })));
    reports.push({ service: image.service, reference: image.reference, imageId: image.imageId,
      scannedAt: new Date().toISOString(), critical: findings.filter(item => item.severity === 'CRITICAL').length,
      high: findings.filter(item => item.severity === 'HIGH').length, findings,
      coverage: (report.Results || []).map(result => ({ type: result.Type, class: result.Class })) });
    rmSync(archive);
    console.log(JSON.stringify({ service: image.service, scanned: true }));
  }
  const output = `${imageRoot}/security-review-${Date.now()}.json`;
  writeFileSync(output, JSON.stringify({ version: 1, scope: 'recorded-release-off-vps-artifacts', scanner: 'Trivy 0.74.0',
    scannerSha256: await fileHash(scanner), scannerDatabase: execFileSync(scanner, ['--version'], { encoding: 'utf8' }).trim(),
    scannedAt: new Date().toISOString(), liveVpsRevalidated: false, missingArtifacts: inventory.unavailable,
    reports, riskAcceptanceGranted: false }, null, 2), { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ status: 'recorded-artifact-scans-complete', missing: inventory.unavailable, riskAcceptanceGranted: false }));
} catch (error) {
  console.error(`Recorded artifact scan incomplete at ${stage}; no security acceptance claimed.`);
  const line = String(error?.stack || '').match(/scan-staging-recovery-images\.mjs:(\d+):(\d+)/);
  if (line) console.error(`Scanner check location ${line[1]}:${line[2]}.`);
  process.exitCode = 1;
}
finally { if (scratch) rmSync(scratch, { recursive: true }); }
