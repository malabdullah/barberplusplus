import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
test('behavior comparison preserves function bodies and removes only top-level comments', () => {
  const code = `import importlib.util
s=importlib.util.spec_from_file_location('normalizer','scripts/normalize-schema.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
body="CREATE FUNCTION f() RETURNS text AS $$\\nCOMMENT ON TABLE x IS 'keep inside body';\\n$$ LANGUAGE sql;\\n"
assert m.behavioral_schema(body)==body
assert m.behavioral_schema("COMMENT ON TABLE public.x IS 'only documentation';\\n")=="\\n"
assert m.behavioral_schema("SELECT 'COMMENT ON TABLE';\\n")=="SELECT 'COMMENT ON TABLE';\\n"
`;
  const r = spawnSync('python3', ['-c', code], { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  assert.equal(r.status, 0, r.stderr);
});
