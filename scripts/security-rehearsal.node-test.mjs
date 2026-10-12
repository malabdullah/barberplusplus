import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { ESLint } from 'eslint';
import globals from 'globals';
import { requireCleanSecurityAdvisors } from './security-advisor-result.mjs';

const source = readFileSync(new URL('./rehearse-test-security-rebuild.mjs', import.meta.url), 'utf8');

test('native security rehearsal has no undefined process APIs or globals', async () => {
  const eslint = new ESLint({ overrideConfigFile: true, overrideConfig: [{
    files: ['**/*.mjs'], languageOptions: { sourceType: 'module', globals: globals.node },
    rules: { 'no-undef': 'error' },
  }] });
  const [result] = await eslint.lintText(source, { filePath: 'rehearse-test-security-rebuild.mjs' });
  assert.deepEqual(result.messages, []);
});

test('security rehearsal preserves fixed target and existing acceptance freeze', () => {
  assert.ok(source.includes("assert.equal(hostname(), 'srv1207055')"));
  assert.ok(source.includes('assert.equal(existsSync(OPERATION_LOCK), false)'));
  assert.ok(source.includes("assert.deepEqual(readFileSync('/opt/barber-staging-test-operations/state.json'),freezeBefore)"));
  assert.ok(source.includes("assert.equal(observedTestRuntime().candidateIdentity,context.candidateIdentity)"));
});

test('security rehearsal requires all database assertions and real Functions denial', () => {
  assert.ok(source.includes("['003_legacy_function_hardening.sql',27]"));
  assert.ok(source.includes('requireRateLimiterFailClosed:true'));
  assert.ok(source.includes('assert.equal(bundleManifest.sourceCommit,functionCandidate.sourceCommit)'));
  assert.ok(source.includes('requireCleanSecurityAdvisors(advisors)'));
  assert.ok(source.includes("'--fail-on','warn','--output-format','json'"));
});

test('advisor gate accepts only successful, explicit empty structured results', () => {
  assert.deepEqual(requireCleanSecurityAdvisors('{"results":[],"message":"No issues found"}'),
    { structuredResultsVerified: true, findings: 0 });
  for (const raw of ['', ' ', 'not-json', '[]', '{}', '{"results":null,"message":"none"}',
    '{"results":[],"message":"none","unexpected":true}',
    '{"results":[{"name":"function_search_path_mutable","level":"WARN"}],"message":"Found issues"}',
    '{"results":[{"name":"other_security_finding","level":"ERROR"}],"message":"Found issues"}']) {
    assert.throws(() => requireCleanSecurityAdvisors(raw));
  }
  assert.throws(() => requireCleanSecurityAdvisors('{"results":[],"message":"none"}', 1));
  assert.throws(() => requireCleanSecurityAdvisors('x'.repeat(1024 * 1024 + 1)));
});

test('frontend runtime keeps the reviewed base and pins available security patches', () => {
  const dockerfile = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
  assert.ok(dockerfile.includes('nginxinc/nginx-unprivileged:1.30.4-alpine3.24@sha256:45ce1e2e699234253d1def7baa96218a5d00b498d1ba0cbb1a17b6bdf73d1351'));
  for (const pin of ['curl=8.22.0-r0','libcurl=8.22.0-r0','libpng=1.6.59-r0','nghttp2-libs=1.70.0-r0','zlib=1.3.2-r1']) assert.ok(dockerfile.includes(pin));
  assert.ok(dockerfile.indexOf('USER 101') > dockerfile.indexOf('RUN apk add --no-cache'));
});

test('schema export uses container socket and exact pinned official CLI formatting', () => {
  assert.ok(source.includes("'--schema-only','--quote-all-identifiers'"));
  assert.ok(source.includes('assert.equal(transformations.length,26)'));
  assert.ok(source.includes('5c57d52befa24b51df6588fe14f0198481712d1d9ff43a1dc1120133172ae772'));
});
