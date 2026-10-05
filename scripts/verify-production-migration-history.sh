#!/bin/sh
set -eu

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL is required}"
: "${MIGRATION_HISTORY_EVIDENCE:?MIGRATION_HISTORY_EVIDENCE is required}"

umask 077
history_json=$(mktemp)
trap 'rm -f "$history_json"' EXIT

npx supabase migration list \
  --db-url "$SUPABASE_DB_URL" \
  --output-format json > "$history_json"

jq -e '
  .migrations as $rows
  | any($rows[]; .local == "20260901000000" and .remote == "20260901000000")
  and all($rows[]; (.remote == null or .remote == "" or .remote == .local))
' "$history_json" >/dev/null || {
  echo 'Production migration history is unsafe: the repaired baseline is absent or remote-only migrations exist.' >&2
  exit 1
}

jq '{
  verified_baseline: "20260901000000",
  migrations: [.migrations[] | {local, remote, time}],
  decision: "PASS"
}' "$history_json" > "$MIGRATION_HISTORY_EVIDENCE"

echo 'Production migration history contains the repaired baseline and no unexpected remote-only entries.'
