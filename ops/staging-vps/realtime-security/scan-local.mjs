import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { localDockerProbe } from '../../../scripts/local-docker-probe.mjs';
const [image, scanner] = process.argv.slice(2);
assert.equal(process.argv.length, 4);
assert.match(image || '', /^sha256:[a-f0-9]{64}$/);
assert.ok(scanner?.startsWith('/'), 'Use a verified absolute Trivy executable path');
const docker = localDockerProbe();
const [index] = JSON.parse(docker(['image', 'inspect', image]));
const [platform] = JSON.parse(docker(['image', 'inspect', '--platform', 'linux/amd64', image]));
assert.equal(index.Id, image);
assert.equal(platform.Config?.Labels?.['cloud.malabdullah.barber.candidate'], 'realtime-security-local-only');
assert.equal(`${platform.Os}/${platform.Architecture}`, 'linux/amd64');
const directory = mkdtempSync('/private/tmp/barber-realtime-scan.');
const archive = `${directory}/candidate.tar`;
// No inherited TRIVY_* suppression/settings, home config or repository ignore
// file. Public DB download only; no registry credentials are needed for --input.
const scannerOptions = { cwd: directory, env: { PATH: process.env.PATH, HOME: directory }, stdio: 'pipe' };
try {
  docker(['image', 'save', '--output', archive, image], { timeout: 180000 });
  execFileSync(scanner, ['image', '--download-db-only', '--disable-telemetry', '--skip-version-check',
    '--cache-dir', `${directory}/cache`, '--no-progress'], { ...scannerOptions, timeout: 300000 });
  execFileSync(scanner, ['image', '--input', archive, '--scanners', 'vuln', '--disable-telemetry',
    '--skip-version-check', '--skip-db-update', '--cache-dir', `${directory}/cache`, '--no-progress',
    '--timeout', '5m', '--format', 'json', '--output', `${directory}/raw.json`],
  { ...scannerOptions, timeout: 360000 });
  const raw = readFileSync(`${directory}/raw.json`);
  const scan = JSON.parse(raw);
  assert.ok(scan.Results?.some(r => r.Class === 'os-pkgs' && r.Packages?.length > 0), 'OS coverage absent');
  const findings = scan.Results.flatMap(r => (r.Vulnerabilities || []).map(v => ({
    id: v.VulnerabilityID, package: v.PkgName, installed: v.InstalledVersion,
    fixed: v.FixedVersion || null, severity: v.Severity })));
  const summary = { localReference: image, platformId: platform.Id, directory, authorizing: false,
    rawSha256: createHash('sha256').update(raw).digest('hex'),
    database: JSON.parse(readFileSync(`${directory}/cache/db/metadata.json`, 'utf8')),
    coverage: scan.Results.map(r => ({ type: r.Type, packages: r.Packages?.length || 0 })),
    languageCoverageCaution: 'OS scan does not establish Elixir/Erlang or compiled Bun dependency safety',
    high: findings.filter(v => v.severity === 'HIGH').length,
    critical: findings.filter(v => v.severity === 'CRITICAL').length, findings };
  writeFileSync(`${directory}/summary.json`, JSON.stringify(summary, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ ...summary, findings: undefined }, null, 2));
} finally {
  // Only this invocation's exact generated archive; retain the raw evidence/DB.
  rmSync(archive, { force: true });
}
