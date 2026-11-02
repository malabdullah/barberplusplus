#!/bin/sh
set -eu
test -f supabase/.baseline-ready
mkdir -p .local-test
chmod 700 .local-test
umask 077
node scripts/local-test.mjs status >/dev/null
npx supabase db dump --local --schema public --file .local-test/schema.actual.sql >/dev/null
python3 scripts/normalize-schema.py supabase/schema.expected.sql > .local-test/schema.expected.normalized.sql
python3 scripts/normalize-schema.py .local-test/schema.actual.sql > .local-test/schema.actual.normalized.sql
if ! diff -u .local-test/schema.expected.normalized.sql .local-test/schema.actual.normalized.sql > .local-test/schema.diff; then
  python3 scripts/schema-drift-summary.py .local-test/schema.expected.normalized.sql .local-test/schema.actual.normalized.sql
  echo 'SCHEMA_DRIFT_FAIL: inspect private .local-test/schema.diff' >&2
  exit 1
fi
echo SCHEMA_EQUIVALENT_PASS
