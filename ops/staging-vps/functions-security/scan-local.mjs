import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { localDockerProbe } from '../../../scripts/local-docker-probe.mjs';
const [image, scanner] = process.argv.slice(2);
assert.equal(process.argv.length, 4);
assert.match(image || '', /^sha256:[a-f0-9]{64}$/);
assert.ok(scanner?.startsWith('/'));
const docker = localDockerProbe();
const [platform] = JSON.parse(docker(['image', 'inspect', '--platform', 'linux/amd64', image]));
assert.equal(platform.Config?.Labels?.['cloud.malabdullah.barber.candidate'], 'edge-runtime-security-local-only');
assert.equal(`${platform.Os}/${platform.Architecture}`, 'linux/amd64');
const directory = mkdtempSync('/private/tmp/barber-edge-scan.');
const archive = `${directory}/candidate.tar`;
const options = { cwd: directory, env: { PATH: process.env.PATH, HOME: directory }, stdio: 'pipe' };
try {
  docker(['image', 'save', '--output', archive, image], { timeout: 180000 });
  execFileSync(scanner, ['image', '--download-db-only', '--disable-telemetry', '--skip-version-check',
    '--cache-dir', `${directory}/cache`, '--no-progress'], { ...options, timeout: 300000 });
  execFileSync(scanner, ['image', '--input', archive, '--scanners', 'vuln', '--disable-telemetry',
    '--skip-version-check', '--skip-db-update', '--cache-dir', `${directory}/cache`, '--no-progress',
    '--timeout', '5m', '--format', 'json', '--output', `${directory}/raw.json`], { ...options, timeout: 360000 });
  const raw = readFileSync(`${directory}/raw.json`);
  const scan = JSON.parse(raw);
  assert.ok(scan.Results?.some(r => r.Class === 'os-pkgs' && r.Packages?.length > 0), 'OS coverage absent');
  const findings = scan.Results.flatMap(r => (r.Vulnerabilities || []).map(v => ({
    id: v.VulnerabilityID, package: v.PkgName, installed: v.InstalledVersion, severity: v.Severity })));
  const summary = { localReference: image, platformId: platform.Id, directory, authorizing: false,
    rawSha256: createHash('sha256').update(raw).digest('hex'),
    database: JSON.parse(readFileSync(`${directory}/cache/db/metadata.json`, 'utf8')),
    coverage: scan.Results.map(r => ({ type: r.Type, packages: r.Packages?.length || 0 })),
    applicationCoverageCaution: 'OS scan does not establish statically compiled Rust/Deno/V8 or ONNX dependency safety',
    high: findings.filter(v => v.severity === 'HIGH').length,
    critical: findings.filter(v => v.severity === 'CRITICAL').length, findings };
  writeFileSync(`${directory}/summary.json`, JSON.stringify(summary, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ ...summary, findings: undefined }, null, 2));
} finally { rmSync(archive, { force: true }); }
