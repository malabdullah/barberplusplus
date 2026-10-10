import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertArchiveConfig } from './staging-image-archive-config.mjs';
test('only Docker standard scratch PATH normalization is accepted', () => {
  assertArchiveConfig({ Env: null }, {});
  assertArchiveConfig({ Env: [] }, { Env: null });
  assertArchiveConfig({ Entrypoint: ['/bin/postgrest'] }, { Entrypoint: ['/bin/postgrest'], Env: ['PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'] });
  assert.throws(() => assertArchiveConfig({}, { Env: ['PATH=/evil'] }));
  assert.throws(() => assertArchiveConfig({ Env: ['MODE=staging'] }, { Env: ['MODE=production'] }));
  assert.throws(() => assertArchiveConfig({ User: '10001' }, { User: '0' }));
});
