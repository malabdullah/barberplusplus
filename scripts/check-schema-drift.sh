#!/bin/sh
set -eu

expected=supabase/schema.expected.sql
if [ ! -f "$expected" ]; then
  echo "Missing $expected; generate it during the approved baseline review." >&2
  exit 1
fi

actual=$(mktemp)
normalized_expected=$(mktemp)
normalized_actual=$(mktemp)
trap 'rm -f "$actual" "$normalized_expected" "$normalized_actual"' EXIT

npx supabase db dump --local --schema public --file "$actual"

# Normalize only dump metadata, blank lines outside bodies, and adjacent GRANT order.
python3 scripts/normalize-schema.py "$expected" > "$normalized_expected"
python3 scripts/normalize-schema.py "$actual" > "$normalized_actual"

diff -u "$normalized_expected" "$normalized_actual"
