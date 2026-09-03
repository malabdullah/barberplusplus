#!/bin/sh
set -eu

: "${PRODUCTION_DB_URL:?PRODUCTION_DB_URL is required}"
: "${ALLOW_SCHEMA_CAPTURE:?Set ALLOW_SCHEMA_CAPTURE=yes after backup verification and schema freeze}"

if [ "$ALLOW_SCHEMA_CAPTURE" != yes ]; then
  echo "ALLOW_SCHEMA_CAPTURE must equal yes." >&2
  exit 1
fi

output=${1:-}
if [ -z "$output" ]; then
  echo "Usage: scripts/capture-baseline-candidate.sh /absolute/path/baseline-candidate.sql" >&2
  exit 1
fi

case "$output" in
  /*) ;;
  *) echo "Output path must be absolute." >&2; exit 1 ;;
esac

if [ -e "$output" ]; then
  echo "Refusing to overwrite existing output: $output" >&2
  exit 1
fi

umask 077
npx supabase db dump \
  --db-url "$PRODUCTION_DB_URL" \
  --schema public \
  --file "$output"

echo "Schema-only candidate written to $output. Complete the separate Storage, Realtime, grants, Vault-name, and cron inventories in docs/database-baseline.md."
