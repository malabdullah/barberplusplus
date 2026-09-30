import assert from 'node:assert/strict';
import { POSTGRES_IMAGE } from './check-vps-compose.mjs';

// Local probe opt-in only. This does not alter the VPS deployment allowlist.
export function validateCandidateId(value) {
  assert.match(value, /^sha256:[a-f0-9]{64}$/, 'Candidate must be an exact local image ID');
  return value;
}

export function validateCandidateMetadata(candidate, base, platform) {
  assert.equal(`${candidate.Os}/${candidate.Architecture}`, platform);
  assert.equal(candidate.Config.Labels['cloud.malabdullah.barber.staging.postgres-patch'], 'gosu-go1.27.1-v1');
  assert.equal(candidate.Config.Labels['cloud.malabdullah.barber.staging.gosu-source'], '6456aaa0f3c854d199d0f037f068eb97515b7513');
  assert.equal(candidate.Config.Labels['org.opencontainers.image.base.digest'], POSTGRES_IMAGE.split('@')[1]);
  // Labels are evidence of intent, not proof. Require unchanged upstream layers
  // and runtime configuration, with exactly one extra helper filesystem layer.
  assert.deepEqual(candidate.RootFS.Layers.slice(0, -1), base.RootFS.Layers);
  const withoutLabels = ({ Labels: _labels, ...config }) => config;
  assert.deepEqual(withoutLabels(candidate.Config), withoutLabels(base.Config));
}

export function inspectCandidate(docker, value, platform) {
  const id = validateCandidateId(value);
  const candidate = inspectPlatformImage(docker, id, platform);
  const base = inspectPlatformImage(docker, POSTGRES_IMAGE, platform);
  assert.equal(candidate.Id, id);
  validateCandidateMetadata(candidate, base, platform);
  return id;
}

export function inspectPlatformImage(docker, ref, platform) {
  let output;
  try {
    output = docker(['image', 'inspect', '--platform', platform, ref]);
  } catch (error) {
    // Older/classic Docker stores cannot select a platform during inspection.
    // Only retry that specific capability error, and still verify the result.
    assert.match(String(error.stderr), /unknown flag: --platform|requires API version|server API version|does not support.*platform|platform.*not supported|platform selection is only supported/i);
    output = docker(['image', 'inspect', ref]);
  }
  const [metadata] = JSON.parse(output);
  assert.equal(`${metadata.Os}/${metadata.Architecture}`, platform);
  return metadata;
}
