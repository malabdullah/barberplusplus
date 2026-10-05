import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildGhAttestationVerifyArguments,
  buildGhAttestationVerifyOnlineArguments,
  buildGhImageAttestationVerifyOnlineArguments,
  parseGhAttestationVerification,
  verifyStagingEnvelopeAttestation,
  verifyStagingEnvelopeAttestationOnline,
  verifyStagingImageAttestationOnline,
} from './staging-attestation-verifier.mjs';

const commit = 'a'.repeat(40);
const artifactDigest = 'b'.repeat(64);
const releaseRunId = '37187260000';
const releaseRunAttempt = 2;
const workflowUri = 'https://github.com/malabdullah/barberplusplus/.github/workflows/deploy-staging.yml@refs/heads/main';

function verifiedOutput() {
  return [{
    verificationResult: {
      signature: {
        certificate: {
          issuer: 'https://token.actions.githubusercontent.com',
          subjectAlternativeName: workflowUri,
          buildSignerURI: workflowUri,
          buildSignerDigest: commit,
          runnerEnvironment: 'github-hosted',
          sourceRepositoryURI: 'https://github.com/malabdullah/barberplusplus',
          sourceRepositoryDigest: commit,
          sourceRepositoryRef: 'refs/heads/main',
          sourceRepositoryIdentifier: '1123713308',
          sourceRepositoryOwnerURI: 'https://github.com/malabdullah',
          sourceRepositoryOwnerIdentifier: '19295903',
          buildConfigURI: workflowUri,
          buildConfigDigest: commit,
          buildTrigger: 'workflow_run',
          runInvocationURI: `https://github.com/malabdullah/barberplusplus/actions/runs/${releaseRunId}/attempts/${releaseRunAttempt}`,
          sourceRepositoryVisibilityAtSigning: 'public',
        },
      },
      verifiedTimestamps: [{ type: 'transparency-log', timestamp: '2026-10-04T12:00:00Z' }],
      statement: {
        predicateType: 'https://slsa.dev/provenance/v1',
        subject: [{ name: 'staging-release-request.json', digest: { sha256: artifactDigest } }],
        predicate: { ignoredBecauseWorkflowControlled: true },
      },
    },
  }];
}

const parse = (value = verifiedOutput()) => parseGhAttestationVerification(JSON.stringify(value), {
  artifactDigest, commit, releaseRunId, releaseRunAttempt,
});

test('builds a fail-closed offline gh verifier command with every supported identity constraint', () => {
  const args = buildGhAttestationVerifyArguments({
    artifactPath: '/evidence/request.json',
    bundlePath: '/evidence/request.bundle.jsonl',
    trustedRootPath: '/etc/barber/trusted_root.jsonl',
    commit,
  });
  assert.deepEqual(args, [
    'attestation', 'verify', '/evidence/request.json',
    '--bundle', '/evidence/request.bundle.jsonl',
    '--custom-trusted-root', '/etc/barber/trusted_root.jsonl',
    '--repo', 'malabdullah/barberplusplus',
    '--predicate-type', 'https://slsa.dev/provenance/v1',
    '--cert-oidc-issuer', 'https://token.actions.githubusercontent.com',
    '--cert-identity', workflowUri,
    '--signer-digest', commit,
    '--source-digest', commit,
    '--source-ref', 'refs/heads/main',
    '--deny-self-hosted-runners',
    '--format', 'json',
  ]);
});

test('builds an online verifier command that fetches only repository-linked attestations', () => {
  const args = buildGhAttestationVerifyOnlineArguments({ artifactPath: '/evidence/request.json', commit });
  assert.deepEqual(args, [
    'attestation', 'verify', '/evidence/request.json',
    '--repo', 'malabdullah/barberplusplus',
    '--predicate-type', 'https://slsa.dev/provenance/v1',
    '--cert-oidc-issuer', 'https://token.actions.githubusercontent.com',
    '--cert-identity', workflowUri,
    '--signer-digest', commit,
    '--source-digest', commit,
    '--source-ref', 'refs/heads/main',
    '--deny-self-hosted-runners',
    '--format', 'json',
  ]);
  assert.equal(args.includes('--bundle'), false);
  assert.equal(args.includes('--custom-trusted-root'), false);
});

test('accepts verified certificate claims but explicitly does not authorize release', () => {
  const result = parse();
  assert.equal(result.status, 'certificate-policy-output-valid');
  assert.equal(result.cryptographyVerified, false);
  assert.equal(result.authorizing, false);
  assert.ok(result.remainingAuthorizationChecks.includes('github-workflow-run-approval-history'));
  assert.ok(result.remainingAuthorizationChecks.includes('server-replay-ledger'));
});

test('ignores workflow-controlled predicate fields and rejects subject substitution', () => {
  const output = verifiedOutput();
  output[0].verificationResult.statement.predicate.environment = 'staging';
  assert.equal(parse(output).authorizing, false);
  output[0].verificationResult.statement.subject[0].digest.sha256 = 'c'.repeat(64);
  assert.throws(() => parse(output), /statement.subject.digest.sha256/);
});

test('rejects repository, owner, workflow, source and run identity substitutions', () => {
  for (const [field, replacement] of [
    ['sourceRepositoryIdentifier', '1'],
    ['sourceRepositoryOwnerIdentifier', '2'],
    ['subjectAlternativeName', `${workflowUri}-other`],
    ['buildSignerDigest', 'c'.repeat(40)],
    ['sourceRepositoryDigest', 'd'.repeat(40)],
    ['sourceRepositoryRef', 'refs/heads/feature'],
    ['runInvocationURI', 'https://github.com/malabdullah/barberplusplus/actions/runs/1/attempts/1'],
    ['runnerEnvironment', 'self-hosted'],
    ['buildTrigger', 'pull_request'],
  ]) {
    const output = verifiedOutput();
    output[0].verificationResult.signature.certificate[field] = replacement;
    assert.throws(() => parse(output), new RegExp(field));
  }
});

test('rejects ambiguous results, absent timestamps and malformed verifier output', () => {
  assert.throws(() => parse([]), /exactly one/);
  assert.throws(() => parse([verifiedOutput()[0], verifiedOutput()[0]]), /exactly one/);
  const noTimestamp = verifiedOutput();
  noTimestamp[0].verificationResult.verifiedTimestamps = [];
  assert.throws(() => parse(noTimestamp), /timestamp/);
  assert.throws(() => parseGhAttestationVerification('{', { artifactDigest, commit, releaseRunId, releaseRunAttempt }), /not JSON/);
});

test('rejects unsafe paths, commits, digests, run IDs, attempts and verifier binaries', async () => {
  assert.throws(() => buildGhAttestationVerifyArguments({ artifactPath: 'relative', bundlePath: '/b', trustedRootPath: '/r', commit }));
  assert.throws(() => buildGhAttestationVerifyArguments({ artifactPath: '/a', bundlePath: '/a', trustedRootPath: '/r', commit }));
  assert.throws(() => buildGhAttestationVerifyArguments({ artifactPath: '/a', bundlePath: '/b', trustedRootPath: '/r', commit: 'bad' }));
  assert.throws(() => parseGhAttestationVerification('[]', { artifactDigest: 'bad', commit, releaseRunId, releaseRunAttempt }));
  await assert.rejects(() => verifyStagingEnvelopeAttestation({
    artifactPath: '/a', bundlePath: '/b', trustedRootPath: '/r', artifactDigest,
    commit, releaseRunId, releaseRunAttempt, ghPath: '/tmp/gh', execute: async () => ({ stdout: '[]' }),
  }), /ghPath/);
});

test('delegates cryptography only to allowlisted gh without a shell', async () => {
  let invocation;
  const result = await verifyStagingEnvelopeAttestation({
    artifactPath: '/evidence/request.json',
    bundlePath: '/evidence/request.bundle.jsonl',
    trustedRootPath: '/etc/barber/trusted_root.jsonl',
    artifactDigest,
    commit,
    releaseRunId,
    releaseRunAttempt,
    ghPath: '/opt/homebrew/bin/gh',
    execute: async (...args) => {
      invocation = args;
      return { stdout: JSON.stringify(verifiedOutput()) };
    },
  });
  assert.equal(result.status, 'cryptography-and-certificate-policy-valid');
  assert.equal(result.cryptographyVerified, true);
  assert.equal(result.authorizing, false);
  assert.equal(invocation[0], '/opt/homebrew/bin/gh');
  assert.equal(invocation[2].shell, undefined);
  assert.equal(invocation[2].timeout, 30_000);
});

test('online verification upgrades only successful gh output and remains non-authorizing', async () => {
  let invocation;
  const result = await verifyStagingEnvelopeAttestationOnline({
    artifactPath: '/evidence/request.json', artifactDigest, commit, releaseRunId, releaseRunAttempt,
    execute: async (...args) => { invocation = args; return { stdout: JSON.stringify(verifiedOutput()) }; },
  });
  assert.equal(result.status, 'cryptography-and-certificate-policy-valid');
  assert.equal(result.cryptographyVerified, true);
  assert.equal(result.verificationMode, 'authenticated-github-api');
  assert.equal(result.authorizing, false);
  assert.equal(invocation[0], '/usr/bin/gh');
  assert.equal(invocation[1].includes('--bundle'), false);
  assert.equal(invocation[2].shell, undefined);
});

test('root-installed official staging CLI path is explicitly supported without PATH lookup', async () => {
  let binary;
  const result = await verifyStagingEnvelopeAttestationOnline({
    artifactPath: '/evidence/request.json', artifactDigest, commit, releaseRunId, releaseRunAttempt,
    ghPath: '/usr/local/bin/gh',
    execute: async (file) => { binary = file; return { stdout: JSON.stringify(verifiedOutput()) }; },
  });
  assert.equal(binary, '/usr/local/bin/gh');
  assert.equal(result.authorizing, false);
});

test('verifies each immutable GHCR subject against the release workflow identity', async () => {
  const repository = 'ghcr.io/malabdullah/barberplusplus';
  const digest = `sha256:${artifactDigest}`;
  const manifestEvidence = {
    status: 'read-only-ghcr-manifest-collected', authorizing: false,
    repository: 'malabdullah/barberplusplus', digest,
  };
  const args = buildGhImageAttestationVerifyOnlineArguments({ repository, digest, commit });
  assert.equal(args[2], `oci://${repository}@${digest}`);
  const output = verifiedOutput();
  output[0].verificationResult.statement.subject[0].name = repository;
  const result = await verifyStagingImageAttestationOnline({
    role: 'frontend', repository, digest, manifestEvidence, commit, releaseRunId, releaseRunAttempt,
    execute: async () => ({ stdout: JSON.stringify(output) }),
  });
  assert.deepEqual({ status: result.status, role: result.role, digest: result.digest, authorizing: result.authorizing }, {
    status: 'image-manifest-and-attestation-valid', role: 'frontend', digest, authorizing: false,
  });
  await assert.rejects(() => verifyStagingImageAttestationOnline({
    role: 'frontend', repository, digest, commit, releaseRunId, releaseRunAttempt,
    execute: async () => ({ stdout: JSON.stringify(output) }),
  }), /manifest evidence/);
  await assert.rejects(() => verifyStagingImageAttestationOnline({
    role: 'functions', repository, digest, manifestEvidence, commit, releaseRunId, releaseRunAttempt,
    execute: async () => ({ stdout: JSON.stringify(output) }),
  }), /image repository/);
});

test('never upgrades caller-supplied JSON to cryptographically verified', () => {
  const result = parseGhAttestationVerification(JSON.stringify(verifiedOutput()), {
    artifactDigest, commit, releaseRunId, releaseRunAttempt,
  });
  assert.deepEqual(
    { status: result.status, cryptographyVerified: result.cryptographyVerified, authorizing: result.authorizing },
    { status: 'certificate-policy-output-valid', cryptographyVerified: false, authorizing: false },
  );
});
