import assert from 'node:assert/strict';

// The pinned CLI's --output-format=json is distinct from the status-only
// --output=json option. Never interpret silent output as a clean assessment.
export function requireCleanSecurityAdvisors(stdout, exitStatus = 0) {
  assert.equal(exitStatus, 0, 'Security advisor command did not succeed');
  assert.ok(typeof stdout === 'string' && Buffer.byteLength(stdout) > 0
    && Buffer.byteLength(stdout) <= 1024 * 1024, 'Advisor evidence absent or oversized');
  let report;
  try { report = JSON.parse(stdout); }
  catch { throw new Error('Advisor evidence is not valid JSON'); }
  assert.ok(report && typeof report === 'object' && !Array.isArray(report));
  assert.deepEqual(Object.keys(report).sort(), ['message', 'results']);
  assert.equal(typeof report.message, 'string');
  assert.ok(Array.isArray(report.results), 'Structured advisor results are absent');
  assert.equal(report.results.length, 0, 'Security advisor findings require disposition');
  return Object.freeze({ structuredResultsVerified: true, findings: 0 });
}
