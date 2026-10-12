import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { ESLint } from 'eslint';
import globals from 'globals';

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
  assert.ok(source.includes("assert.ok(!advisors.includes('function_search_path_mutable'))"));
});
