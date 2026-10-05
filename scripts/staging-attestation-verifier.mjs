import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const execFileAsync = promisify(execFile);
const shaPattern = /^[0-9a-f]{40}$/;
const digestPattern = /^[0-9a-f]{64}$/;
const decimalPattern = /^[1-9]\d*$/;
const imageDigestPattern = /^sha256:[0-9a-f]{64}$/;

export const barberAttestationPolicy = Object.freeze({
  repository: 'malabdullah/barberplusplus',
  repositoryId: '1123713308',
  ownerId: '19295903',
  workflowPath: '.github/workflows/deploy-staging.yml',
  sourceRef: 'refs/heads/main',
  eventName: 'workflow_run',
  visibility: 'public',
  runnerEnvironment: 'github-hosted',
  oidcIssuer: 'https://token.actions.githubusercontent.com',
  predicateType: 'https://slsa.dev/provenance/v1',
});

const remainingAuthorizationChecks = Object.freeze([
  'github-workflow-run-metadata',
  'github-workflow-run-approval-history',
  'github-staging-environment-policy',
  'workflow-blob-allowlist',
  'release-envelope-syntax',
  'ghcr-image-attestations',
  'migration-evidence',
  'trusted-clock',
  'server-replay-ledger',
  'broker-authorization',
]);

function fail(message) {
  throw new Error(`Invalid verified staging attestation: ${message}`);
}

function exactString(value, expected, name) {
  if (typeof value !== 'string' || value !== expected) fail(`${name} does not match policy`);
}

function requireAbsoluteFilePath(value, name) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0')) {
    fail(`${name} must be an absolute local path`);
  }
}

function commonVerifyArguments({ artifactPath, commit, allowOci = false }) {
  if (!allowOci) requireAbsoluteFilePath(artifactPath, 'artifactPath');
  if (typeof commit !== 'string' || !shaPattern.test(commit)) fail('commit must be a lowercase full SHA');
  const workflowIdentity = `https://github.com/${barberAttestationPolicy.repository}/${barberAttestationPolicy.workflowPath}@${barberAttestationPolicy.sourceRef}`;
  return [
    'attestation', 'verify', artifactPath,
    '--repo', barberAttestationPolicy.repository,
    '--predicate-type', barberAttestationPolicy.predicateType,
    '--cert-oidc-issuer', barberAttestationPolicy.oidcIssuer,
    '--cert-identity', workflowIdentity,
    '--signer-digest', commit,
    '--source-digest', commit,
    '--source-ref', barberAttestationPolicy.sourceRef,
    '--deny-self-hosted-runners',
    '--format', 'json',
  ];
}

export function buildGhAttestationVerifyArguments({
  artifactPath,
  bundlePath,
  trustedRootPath,
  commit,
}) {
  requireAbsoluteFilePath(bundlePath, 'bundlePath');
  requireAbsoluteFilePath(trustedRootPath, 'trustedRootPath');
  if (new Set([artifactPath, bundlePath, trustedRootPath]).size !== 3) fail('verification paths must be distinct');
  const common = commonVerifyArguments({ artifactPath, commit });
  return Object.freeze([
    ...common.slice(0, 3),
    '--bundle', bundlePath,
    '--custom-trusted-root', trustedRootPath,
    ...common.slice(3),
  ]);
}

export function buildGhAttestationVerifyOnlineArguments({ artifactPath, commit }) {
  return Object.freeze(commonVerifyArguments({ artifactPath, commit }));
}

export function buildGhImageAttestationVerifyOnlineArguments({ repository, digest, commit }) {
  if (!['ghcr.io/malabdullah/barberplusplus', 'ghcr.io/malabdullah/barberplusplus-functions'].includes(repository)) {
    fail('image repository is not allowlisted');
  }
  if (typeof digest !== 'string' || !imageDigestPattern.test(digest)) fail('image digest is invalid');
  const target = `oci://${repository}@${digest}`;
  return Object.freeze(commonVerifyArguments({ artifactPath: target, commit, allowOci: true }));
}

export function parseGhAttestationVerification(raw, {
  artifactDigest,
  subjectName = 'staging-release-request.json',
  commit,
  releaseRunId,
  releaseRunAttempt,
} = {}) {
  if (typeof raw !== 'string' || Buffer.byteLength(raw, 'utf8') > 1024 * 1024) fail('CLI output is absent or oversized');
  if (typeof artifactDigest !== 'string' || !digestPattern.test(artifactDigest)) fail('artifactDigest must be 64 lowercase hexadecimal characters');
  if (typeof subjectName !== 'string' || subjectName.length === 0 || subjectName.length > 256 || /[\0\r\n]/.test(subjectName)) fail('subjectName is invalid');
  if (typeof commit !== 'string' || !shaPattern.test(commit)) fail('commit must be a lowercase full SHA');
  if (typeof releaseRunId !== 'string' || !decimalPattern.test(releaseRunId)) fail('releaseRunId must be a positive decimal string');
  if (!Number.isSafeInteger(releaseRunAttempt) || releaseRunAttempt < 1 || releaseRunAttempt > 1000) fail('releaseRunAttempt is invalid');

  let results;
  try {
    results = JSON.parse(raw);
  } catch {
    fail('CLI output is not JSON');
  }
  if (!Array.isArray(results) || results.length !== 1) fail('exactly one verified attestation is required');

  const result = results[0]?.verificationResult;
  const certificate = result?.signature?.certificate;
  const statement = result?.statement;
  if (!certificate || typeof certificate !== 'object') fail('verified certificate summary is absent');
  if (!statement || typeof statement !== 'object') fail('verified statement is absent');
  if (!Array.isArray(result.verifiedTimestamps) || result.verifiedTimestamps.length === 0) fail('verified timestamp is absent');

  const repositoryUri = `https://github.com/${barberAttestationPolicy.repository}`;
  const workflowUri = `${repositoryUri}/${barberAttestationPolicy.workflowPath}@${barberAttestationPolicy.sourceRef}`;
  const runUri = `${repositoryUri}/actions/runs/${releaseRunId}/attempts/${releaseRunAttempt}`;
  exactString(certificate.issuer, barberAttestationPolicy.oidcIssuer, 'certificate.issuer');
  exactString(certificate.subjectAlternativeName, workflowUri, 'certificate.subjectAlternativeName');
  exactString(certificate.buildSignerURI, workflowUri, 'certificate.buildSignerURI');
  exactString(certificate.buildSignerDigest, commit, 'certificate.buildSignerDigest');
  exactString(certificate.runnerEnvironment, barberAttestationPolicy.runnerEnvironment, 'certificate.runnerEnvironment');
  exactString(certificate.sourceRepositoryURI, repositoryUri, 'certificate.sourceRepositoryURI');
  exactString(certificate.sourceRepositoryDigest, commit, 'certificate.sourceRepositoryDigest');
  exactString(certificate.sourceRepositoryRef, barberAttestationPolicy.sourceRef, 'certificate.sourceRepositoryRef');
  exactString(certificate.sourceRepositoryIdentifier, barberAttestationPolicy.repositoryId, 'certificate.sourceRepositoryIdentifier');
  exactString(certificate.sourceRepositoryOwnerURI, 'https://github.com/malabdullah', 'certificate.sourceRepositoryOwnerURI');
  exactString(certificate.sourceRepositoryOwnerIdentifier, barberAttestationPolicy.ownerId, 'certificate.sourceRepositoryOwnerIdentifier');
  exactString(certificate.buildConfigURI, workflowUri, 'certificate.buildConfigURI');
  exactString(certificate.buildConfigDigest, commit, 'certificate.buildConfigDigest');
  exactString(certificate.buildTrigger, barberAttestationPolicy.eventName, 'certificate.buildTrigger');
  exactString(certificate.runInvocationURI, runUri, 'certificate.runInvocationURI');
  exactString(certificate.sourceRepositoryVisibilityAtSigning, barberAttestationPolicy.visibility, 'certificate.sourceRepositoryVisibilityAtSigning');

  exactString(statement.predicateType, barberAttestationPolicy.predicateType, 'statement.predicateType');
  if (!Array.isArray(statement.subject) || statement.subject.length !== 1) fail('statement must contain exactly one subject');
  exactString(statement.subject[0]?.name, subjectName, 'statement.subject.name');
  const subjectDigest = statement.subject[0]?.digest;
  if (!subjectDigest || Object.keys(subjectDigest).length !== 1) fail('statement subject digest is invalid');
  exactString(subjectDigest.sha256, artifactDigest, 'statement.subject.digest.sha256');

  return Object.freeze({
    status: 'certificate-policy-output-valid',
    cryptographyVerified: false,
    authorizing: false,
    artifactDigest,
    commit,
    releaseRunId,
    releaseRunAttempt,
    remainingAuthorizationChecks,
  });
}

export async function verifyStagingEnvelopeAttestation({
  artifactPath,
  bundlePath,
  trustedRootPath,
  artifactDigest,
  commit,
  releaseRunId,
  releaseRunAttempt,
  ghPath = '/usr/bin/gh',
  execute = execFileAsync,
}) {
  if (!['/usr/bin/gh', '/usr/local/bin/gh', '/opt/homebrew/bin/gh'].includes(ghPath)) fail('ghPath is not allowlisted');
  const args = buildGhAttestationVerifyArguments({ artifactPath, bundlePath, trustedRootPath, commit });
  const { stdout } = await execute(ghPath, args, {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    timeout: 30_000,
    windowsHide: true,
  });
  const policyResult = parseGhAttestationVerification(stdout, {
    artifactDigest,
    commit,
    releaseRunId,
    releaseRunAttempt,
  });
  return Object.freeze({
    ...policyResult,
    status: 'cryptography-and-certificate-policy-valid',
    cryptographyVerified: true,
    authorizing: false,
  });
}

export async function verifyStagingEnvelopeAttestationOnline({
  artifactPath,
  artifactDigest,
  commit,
  releaseRunId,
  releaseRunAttempt,
  ghPath = '/usr/bin/gh',
  execute = execFileAsync,
}) {
  if (!['/usr/bin/gh', '/usr/local/bin/gh', '/opt/homebrew/bin/gh'].includes(ghPath)) fail('ghPath is not allowlisted');
  const args = buildGhAttestationVerifyOnlineArguments({ artifactPath, commit });
  const { stdout } = await execute(ghPath, args, {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    timeout: 30_000,
    windowsHide: true,
  });
  const policyResult = parseGhAttestationVerification(stdout, {
    artifactDigest,
    commit,
    releaseRunId,
    releaseRunAttempt,
  });
  return Object.freeze({
    ...policyResult,
    status: 'cryptography-and-certificate-policy-valid',
    cryptographyVerified: true,
    verificationMode: 'authenticated-github-api',
    authorizing: false,
  });
}

export async function verifyStagingImageAttestationOnline({
  role,
  repository,
  digest,
  manifestEvidence,
  commit,
  releaseRunId,
  releaseRunAttempt,
  ghPath = '/usr/bin/gh',
  execute = execFileAsync,
}) {
  if (!['frontend', 'functions'].includes(role)) fail('image role is not allowed');
  const expectedRepository = role === 'frontend'
    ? 'ghcr.io/malabdullah/barberplusplus'
    : 'ghcr.io/malabdullah/barberplusplus-functions';
  exactString(repository, expectedRepository, 'image repository');
  if (!manifestEvidence || manifestEvidence.status !== 'read-only-ghcr-manifest-collected'
      || manifestEvidence.authorizing !== false
      || `ghcr.io/${manifestEvidence.repository}` !== repository
      || manifestEvidence.digest !== digest) {
    fail('authenticated immutable manifest evidence does not match the image');
  }
  if (!['/usr/bin/gh', '/usr/local/bin/gh', '/opt/homebrew/bin/gh'].includes(ghPath)) fail('ghPath is not allowlisted');
  const args = buildGhImageAttestationVerifyOnlineArguments({ repository, digest, commit });
  const { stdout } = await execute(ghPath, args, {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    timeout: 30_000,
    windowsHide: true,
  });
  parseGhAttestationVerification(stdout, {
    artifactDigest: digest.slice('sha256:'.length),
    subjectName: repository,
    commit,
    releaseRunId,
    releaseRunAttempt,
  });
  return Object.freeze({
    status: 'image-manifest-and-attestation-valid',
    attestationVerified: true,
    authorizing: false,
    role,
    repository,
    digest,
    commit,
    releaseRunId,
    releaseRunAttempt,
  });
}
