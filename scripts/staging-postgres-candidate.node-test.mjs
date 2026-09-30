import assert from 'node:assert/strict';
import { test } from 'node:test';
import { POSTGRES_IMAGE } from './check-vps-compose.mjs';
import { inspectPlatformImage, validateCandidateId, validateCandidateMetadata } from './staging-postgres-candidate.mjs';

function fixture() {
  const base = { Os: 'linux', Architecture: 'amd64', RootFS: { Layers: ['base-a', 'base-b'] },
    Config: { Entrypoint: ['docker-entrypoint.sh'], Cmd: ['postgres'], User: '', Env: ['PATH=/bin'], Labels: {} } };
  const candidate = structuredClone(base);
  candidate.RootFS.Layers.push('helper');
  candidate.Config.Labels = {
    'cloud.malabdullah.barber.staging.postgres-patch': 'gosu-go1.27.1-v1',
    'cloud.malabdullah.barber.staging.gosu-source': '6456aaa0f3c854d199d0f037f068eb97515b7513',
    'org.opencontainers.image.base.digest': POSTGRES_IMAGE.split('@')[1],
  };
  return { base, candidate };
}

test('only full local content-addressed image IDs are accepted', () => {
  assert.equal(validateCandidateId(`sha256:${'a'.repeat(64)}`), `sha256:${'a'.repeat(64)}`);
  for (const input of ['latest', 'postgres:patched', `repo@sha256:${'a'.repeat(64)}`, 'sha256:abc', '', '--help']) {
    assert.throws(() => validateCandidateId(input));
  }
});
test('accepts one helper layer on unchanged base and configuration', () => {
  const { candidate, base } = fixture();
  validateCandidateMetadata(candidate, base, 'linux/amd64');
});
const unsafe = {
  'different architecture': (c) => { c.Architecture = 'arm64'; },
  'different OS': (c) => { c.Os = 'windows'; },
  'different source': (c) => { c.Config.Labels['cloud.malabdullah.barber.staging.gosu-source'] = 'other'; },
  'different base claim': (c) => { c.Config.Labels['org.opencontainers.image.base.digest'] = 'other'; },
  'missing patch label': (c) => { delete c.Config.Labels['cloud.malabdullah.barber.staging.postgres-patch']; },
  'changed base layers': (c) => { c.RootFS.Layers[0] = 'other'; },
  'extra layers': (c) => { c.RootFS.Layers.push('unexpected'); },
  'no new layer': (c) => { c.RootFS.Layers.pop(); },
  'changed entrypoint': (c) => { c.Config.Entrypoint = ['sh']; },
  'changed command': (c) => { c.Config.Cmd = ['sh']; },
  'changed runtime environment': (c) => { c.Config.Env.push('UNSAFE=true'); },
  'changed user': (c) => { c.Config.User = 'postgres'; },
};
for (const [name, mutate] of Object.entries(unsafe)) {
  test(`rejects ${name}`, () => {
    const { candidate, base } = fixture();
    mutate(candidate);
    assert.throws(() => validateCandidateMetadata(candidate, base, 'linux/amd64'));
  });
}

test('older Docker inspection fallback still verifies platform', () => {
  let calls = 0;
  const docker = (args) => {
    calls++;
    if (args.includes('--platform')) throw Object.assign(new Error('unsupported'), { stderr: 'unknown flag: --platform' });
    return JSON.stringify([fixture().base]);
  };
  assert.equal(inspectPlatformImage(docker, 'fixture', 'linux/amd64').Architecture, 'amd64');
  assert.equal(calls, 2);
  assert.throws(() => inspectPlatformImage(docker, 'fixture', 'linux/arm64'));
});
test('image lookup errors do not trigger capability fallback', () => {
  let calls = 0;
  assert.throws(() => inspectPlatformImage(() => {
    calls++;
    throw Object.assign(new Error('missing'), { stderr: 'No such image' });
  }, 'fixture', 'linux/amd64'));
  assert.equal(calls, 1);
});
