import { createHash } from 'node:crypto';

const sha1Pattern = /^[0-9a-f]{40}$/;
const sha256Pattern = /^[0-9a-f]{64}$/;
const workflowPath = '.github/workflows/deploy-staging.yml';

export const barberStagingApprovalPolicy = Object.freeze({
  repositoryId: 1123713308,
  repository: 'malabdullah/barberplusplus',
  ownerReviewerId: 19295903,
  ownerReviewerLogin: 'malabdullah',
  environmentId: 21158713380,
  environment: 'staging',
  branch: 'main',
  workflowPath,
  event: 'workflow_run',
});

const remainingAuthorizationChecks = Object.freeze([
  'github-api-transport-and-response-origin',
  'trusted-reviewed-workflow-allowlist',
  'github-attestation',
  'release-envelope-syntax',
  'ghcr-image-attestations',
  'migration-evidence',
  'trusted-clock',
  'server-replay-ledger',
  'broker-authorization',
]);

function fail(message) {
  throw new Error(`Invalid staging approval evidence: ${message}`);
}

function object(value, name) {
  if (value === null || Array.isArray(value) || typeof value !== 'object') fail(`${name} must be an object`);
}

function exact(value, expected, name) {
  if (value !== expected) fail(`${name} does not match policy`);
}

function positiveSafeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) fail(`${name} must be a positive safe integer`);
}

function gitBlobSha(source) {
  const body = Buffer.from(source, 'utf8');
  return createHash('sha1').update(`blob ${body.length}\0`).update(body).digest('hex');
}

function sourceSha256(source) {
  return createHash('sha256').update(source, 'utf8').digest('hex');
}

function validateEnvironmentPolicy(environmentPolicy) {
  object(environmentPolicy, 'environmentPolicy');
  exact(environmentPolicy.id, barberStagingApprovalPolicy.environmentId, 'environmentPolicy.id');
  exact(environmentPolicy.name, barberStagingApprovalPolicy.environment, 'environmentPolicy.name');
  object(environmentPolicy.deployment_branch_policy, 'environmentPolicy.deployment_branch_policy');
  exact(environmentPolicy.deployment_branch_policy.protected_branches, true, 'protected_branches');
  exact(environmentPolicy.deployment_branch_policy.custom_branch_policies, false, 'custom_branch_policies');
  if (!Array.isArray(environmentPolicy.protection_rules)) fail('protection_rules must be an array');
  const reviewerRules = environmentPolicy.protection_rules.filter((rule) => rule?.type === 'required_reviewers');
  const branchRules = environmentPolicy.protection_rules.filter((rule) => rule?.type === 'branch_policy');
  if (reviewerRules.length !== 1 || branchRules.length !== 1 || environmentPolicy.protection_rules.length !== 2) {
    fail('environment must have exactly the reviewed required-reviewer and branch-policy rules');
  }
  const reviewerRule = reviewerRules[0];
  exact(reviewerRule.prevent_self_review, false, 'required_reviewers.prevent_self_review');
  if (!Array.isArray(reviewerRule.reviewers) || reviewerRule.reviewers.length !== 1) {
    fail('required_reviewers must contain only the owner reviewer');
  }
  const reviewer = reviewerRule.reviewers[0];
  exact(reviewer.type, 'User', 'required reviewer type');
  exact(reviewer.reviewer?.id, barberStagingApprovalPolicy.ownerReviewerId, 'required reviewer id');
  exact(reviewer.reviewer?.login, barberStagingApprovalPolicy.ownerReviewerLogin, 'required reviewer login');
}

function validateWorkflowRun(workflowRun, expected) {
  object(workflowRun, 'workflowRun');
  positiveSafeInteger(workflowRun.id, 'workflowRun.id');
  exact(String(workflowRun.id), expected.releaseRunId, 'workflowRun.id');
  positiveSafeInteger(workflowRun.run_attempt, 'workflowRun.run_attempt');
  exact(workflowRun.run_attempt, expected.releaseRunAttempt, 'workflowRun.run_attempt');
  exact(workflowRun.status, 'completed', 'workflowRun.status');
  exact(workflowRun.conclusion, 'success', 'workflowRun.conclusion');
  exact(workflowRun.event, barberStagingApprovalPolicy.event, 'workflowRun.event');
  exact(workflowRun.head_branch, barberStagingApprovalPolicy.branch, 'workflowRun.head_branch');
  exact(workflowRun.head_sha, expected.commit, 'workflowRun.head_sha');
  if (![workflowPath, `${workflowPath}@main`].includes(workflowRun.path)) fail('workflowRun.path does not match policy');
  exact(workflowRun.repository?.id, barberStagingApprovalPolicy.repositoryId, 'workflowRun.repository.id');
  exact(workflowRun.repository?.full_name, barberStagingApprovalPolicy.repository, 'workflowRun.repository.full_name');
  exact(workflowRun.head_repository?.id, barberStagingApprovalPolicy.repositoryId, 'workflowRun.head_repository.id');
  exact(workflowRun.head_repository?.full_name, barberStagingApprovalPolicy.repository, 'workflowRun.head_repository.full_name');
}

function validateWorkflowSource(workflowSource, expected) {
  if (typeof workflowSource !== 'string' || Buffer.byteLength(workflowSource, 'utf8') === 0) {
    fail('workflowSource must be a nonempty string');
  }
  if (!sha1Pattern.test(expected.workflowBlobSha)) fail('expected.workflowBlobSha is invalid');
  if (!sha256Pattern.test(expected.reviewedWorkflowSha256)) fail('expected.reviewedWorkflowSha256 is invalid');
  exact(gitBlobSha(workflowSource), expected.workflowBlobSha, 'reviewed workflow Git blob SHA');
  exact(sourceSha256(workflowSource), expected.reviewedWorkflowSha256, 'reviewed workflow SHA-256');
}

function matchingApprovals(approvalHistory) {
  if (!Array.isArray(approvalHistory)) fail('approvalHistory must be an array');
  return approvalHistory.filter((record) => record?.state === 'approved'
    && record.user?.id === barberStagingApprovalPolicy.ownerReviewerId
    && record.user?.login === barberStagingApprovalPolicy.ownerReviewerLogin
    && Array.isArray(record.environments)
    && record.environments.length === 1
    && record.environments[0]?.id === barberStagingApprovalPolicy.environmentId
    && record.environments[0]?.name === barberStagingApprovalPolicy.environment);
}

export function validateStagingApprovalEvidence({
  environmentPolicy,
  workflowRun,
  approvalHistory,
  workflowSource,
  expected,
}) {
  object(expected, 'expected');
  if (typeof expected.commit !== 'string' || !sha1Pattern.test(expected.commit)) fail('expected.commit is invalid');
  if (typeof expected.releaseRunId !== 'string' || !/^[1-9]\d*$/.test(expected.releaseRunId)) fail('expected.releaseRunId is invalid');
  positiveSafeInteger(expected.releaseRunAttempt, 'expected.releaseRunAttempt');
  validateEnvironmentPolicy(environmentPolicy);
  validateWorkflowRun(workflowRun, expected);
  validateWorkflowSource(workflowSource, expected);

  const approvals = matchingApprovals(approvalHistory);
  if (approvals.length !== 1 || approvalHistory.length !== 1) {
    return Object.freeze({
      status: 'blocked-ambiguous-approval-history',
      authorizing: false,
      attemptBound: false,
      missingProof: Object.freeze([
        'one unambiguous owner approval for only the staging environment',
      ]),
      remainingAuthorizationChecks,
    });
  }

  if (expected.releaseRunAttempt !== 1) {
    return Object.freeze({
      status: 'blocked-approval-not-bound-to-run-attempt',
      authorizing: false,
      attemptBound: false,
      missingProof: Object.freeze([
        'approval-history response has no run_attempt field',
        'approval-history response has no job/check identifier',
        'approval-history response has no approval timestamp',
      ]),
      remainingAuthorizationChecks,
    });
  }

  return Object.freeze({
    status: 'approval-evidence-policy-valid-first-attempt',
    authorizing: false,
    attemptBound: true,
    commit: expected.commit,
    releaseRunId: expected.releaseRunId,
    releaseRunAttempt: expected.releaseRunAttempt,
    workflowBlobSha: expected.workflowBlobSha,
    reviewedWorkflowSha256: expected.reviewedWorkflowSha256,
    environmentId: barberStagingApprovalPolicy.environmentId,
    reviewerId: barberStagingApprovalPolicy.ownerReviewerId,
    remainingAuthorizationChecks,
  });
}

export const stagingApprovalHash = Object.freeze({ gitBlobSha, sourceSha256 });
