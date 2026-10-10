import assert from 'node:assert/strict';

export function assertArchiveConfig(saved, inspected) {
  const expected = structuredClone(saved); const actual = structuredClone(inspected);
  const emptyEnv = value => value === null || value === undefined || (Array.isArray(value) && value.length === 0);
  if (emptyEnv(expected.Env) && emptyEnv(actual.Env)) { delete expected.Env; delete actual.Env; }
  // Docker supplies this standard PATH for a scratch image without Env. It is
  // inspection normalization, not a persisted archive environment change.
  if (!expected.Env?.length && actual.Env?.length === 1
    && actual.Env[0] === 'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin') {
    delete expected.Env; delete actual.Env;
  }
  assert.deepEqual(expected, actual, 'Archive runtime configuration mismatch');
}
