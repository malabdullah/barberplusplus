import assert from 'node:assert/strict';
import test from 'node:test';
import {
  stagingApprovalHash,
  validateStagingApprovalEvidence,
} from './staging-approval-evidence.mjs';

const commit = 'a'.repeat(40);
const workflowSource = `name: Deploy staging
on: workflow_run
jobs:
  evidence:
    environment: staging
    runs-on: ubuntu-latest
`;

function fixtures(attempt = 1) {
  const releaseRunId = '37187260000';
  return {
    environmentPolicy: {
      id: 21158713380,
      name: 'staging',
      protection_rules: [
        {
          id: 66932792,
          type: 'required_reviewers',
          prevent_self_review: false,
          reviewers: [{ type: 'User', reviewer: { id: 19295903, login: 'malabdullah' } }],
        },
        { id: 66932794, type: 'branch_policy' },
      ],
      deployment_branch_policy: { protected_branches: true, custom_branch_policies: false },
    },
    workflowRun: {
      id: Number(releaseRunId),
      run_attempt: attempt,
      status: 'completed',
      conclusion: 'success',
      event: 'workflow_run',
      head_branch: 'main',
      head_sha: commit,
      path: '.github/workflows/deploy-staging.yml',
      repository: { id: 1123713308, full_name: 'malabdullah/barberplusplus' },
      head_repository: { id: 1123713308, full_name: 'malabdullah/barberplusplus' },
    },
    approvalHistory: [{
      state: 'approved',
      comment: 'Reviewed staging release',
      environments: [{ id: 21158713380, name: 'staging' }],
      user: { id: 19295903, login: 'malabdullah' },
    }],
    workflowSource,
    expected: {
      commit,
      releaseRunId,
      releaseRunAttempt: attempt,
      workflowBlobSha: stagingApprovalHash.gitBlobSha(workflowSource),
      reviewedWorkflowSha256: stagingApprovalHash.sourceSha256(workflowSource),
    },
  };
}

test('first-attempt evidence passes policy checks but remains non-authorizing', () => {
  const result = validateStagingApprovalEvidence(fixtures());
  assert.deepEqual(
    { status: result.status, authorizing: result.authorizing, attemptBound: result.attemptBound },
    { status: 'approval-evidence-policy-valid-first-attempt', authorizing: false, attemptBound: true },
  );
  assert.ok(result.remainingAuthorizationChecks.includes('github-api-transport-and-response-origin'));
  assert.ok(result.remainingAuthorizationChecks.includes('broker-authorization'));
});

test('rerun approval evidence is blocked because API history has no attempt binding', () => {
  const result = validateStagingApprovalEvidence(fixtures(2));
  assert.equal(result.status, 'blocked-approval-not-bound-to-run-attempt');
  assert.equal(result.authorizing, false);
  assert.equal(result.attemptBound, false);
  assert.deepEqual(result.missingProof, [
    'approval-history response has no run_attempt field',
    'approval-history response has no job/check identifier',
    'approval-history response has no approval timestamp',
  ]);
});

test('rejects weakened or substituted current environment policy', () => {
  for (const mutate of [
    (value) => { value.environmentPolicy.id += 1; },
    (value) => { value.environmentPolicy.name = 'production'; },
    (value) => { value.environmentPolicy.deployment_branch_policy.protected_branches = false; },
    (value) => { value.environmentPolicy.deployment_branch_policy.custom_branch_policies = true; },
    (value) => { value.environmentPolicy.protection_rules[0].reviewers[0].reviewer.id = 1; },
    (value) => { value.environmentPolicy.protection_rules.push({ type: 'wait_timer' }); },
  ]) {
    const value = fixtures();
    mutate(value);
    assert.throws(() => validateStagingApprovalEvidence(value), /Invalid staging approval evidence/);
  }
});

test('rejects repository, workflow, commit, run and attempt substitutions', () => {
  for (const mutate of [
    (value) => { value.workflowRun.id += 1; },
    (value) => { value.workflowRun.run_attempt += 1; },
    (value) => { value.workflowRun.status = 'in_progress'; },
    (value) => { value.workflowRun.conclusion = 'failure'; },
    (value) => { value.workflowRun.event = 'pull_request'; },
    (value) => { value.workflowRun.head_branch = 'feature'; },
    (value) => { value.workflowRun.head_sha = 'b'.repeat(40); },
    (value) => { value.workflowRun.path = '.github/workflows/other.yml'; },
    (value) => { value.workflowRun.repository.id = 1; },
    (value) => { value.workflowRun.head_repository.full_name = 'attacker/fork'; },
  ]) {
    const value = fixtures();
    mutate(value);
    assert.throws(() => validateStagingApprovalEvidence(value), /Invalid staging approval evidence/);
  }
});

test('rejects unreviewed workflow source or blob substitution', () => {
  const changedSource = fixtures();
  changedSource.workflowSource += '# changed\n';
  assert.throws(() => validateStagingApprovalEvidence(changedSource), /Git blob SHA/);

  const changedReview = fixtures();
  changedReview.expected.reviewedWorkflowSha256 = 'f'.repeat(64);
  assert.throws(() => validateStagingApprovalEvidence(changedReview), /workflow SHA-256/);

  const invalidExpected = fixtures();
  invalidExpected.expected.workflowBlobSha = 'bad';
  assert.throws(() => validateStagingApprovalEvidence(invalidExpected), /workflowBlobSha/);
});

test('blocks absent, rejected, extra or cross-environment approval history', () => {
  for (const mutate of [
    (value) => { value.approvalHistory = []; },
    (value) => { value.approvalHistory[0].state = 'rejected'; },
    (value) => { value.approvalHistory[0].user.id = 1; },
    (value) => { value.approvalHistory[0].environments[0].id += 1; },
    (value) => { value.approvalHistory.push(structuredClone(value.approvalHistory[0])); },
  ]) {
    const value = fixtures();
    mutate(value);
    const result = validateStagingApprovalEvidence(value);
    assert.equal(result.status, 'blocked-ambiguous-approval-history');
    assert.equal(result.authorizing, false);
  }
});

test('fixtures remain policy simulation, not GitHub API authenticity', () => {
  const result = validateStagingApprovalEvidence(fixtures());
  assert.equal(result.authorizing, false);
  assert.ok(result.remainingAuthorizationChecks.includes('github-api-transport-and-response-origin'));
  assert.equal(Object.hasOwn(result, 'apiResponseAuthenticated'), false);
});
