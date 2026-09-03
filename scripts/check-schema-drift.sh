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

# Dump headers contain tool timestamps/version chatter that are not schema.
sed '/^-- Dumped /d; /^-- Started on /d; /^-- Completed on /d' "$expected" > "$normalized_expected"
sed '/^-- Dumped /d; /^-- Started on /d; /^-- Completed on /d' "$actual" > "$normalized_actual"

diff -u "$normalized_expected" "$normalized_actual"
