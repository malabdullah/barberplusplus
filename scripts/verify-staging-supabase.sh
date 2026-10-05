#!/bin/sh
set -eu

target=${1:-}
[ -n "$target" ] || {
  echo "Usage: scripts/verify-staging-supabase.sh /absolute/install/path" >&2
  exit 1
}
case "$target" in /*) ;; *) echo "Install path must be absolute." >&2; exit 1 ;; esac
[ -d "$target" ] || { echo "Supabase install path does not exist." >&2; exit 1; }
[ -f "$target/.env" ] || { echo "Supabase .env is not configured." >&2; exit 1; }
[ -f "$target/.supabase-version" ] || { echo "Missing .supabase-version." >&2; exit 1; }

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
release=$(tr -d '[:space:]' < "$repo_dir/ops/supabase/self-hosted.release")
expected=$(tr -d '[:space:]' < "$repo_dir/ops/supabase/self-hosted.commit")
actual=$(sed -n 's/^ref=//p' "$target/.supabase-version" | tr -d '[:space:]')
[ "$actual" = "$expected" ] || {
  echo "Supabase configuration does not match the repository release pin." >&2
  exit 1
}

images_file=$(mktemp)
cleanup() {
  rm -f "$images_file"
}
trap cleanup EXIT INT TERM

(cd "$target" && docker compose --env-file .env config --images) > "$images_file"
[ -s "$images_file" ] || { echo "Compose configuration returned no images." >&2; exit 1; }
if grep -E '(^|:)latest$|@sha256:$' "$images_file" >/dev/null; then
  echo "Supabase compose configuration contains an unpinned image." >&2
  exit 1
fi

required_values='POSTGRES_PASSWORD SUPABASE_PUBLIC_URL API_EXTERNAL_URL SITE_URL DASHBOARD_PASSWORD SECRET_KEY_BASE REALTIME_DB_ENC_KEY VAULT_ENC_KEY PG_META_CRYPTO_KEY'
for name in $required_values; do
  if ! grep -E "^${name}=.+" "$target/.env" >/dev/null; then
    echo "Supabase configuration is missing $name." >&2
    exit 1
  fi
done

if grep -Ei 'your-super-secret|change.?me|replace.?me|example\.com|supabase-demo' "$target/.env" >/dev/null; then
  echo "Supabase staging configuration still contains a default or placeholder value." >&2
  exit 1
fi

grep -Fx 'SUPABASE_PUBLIC_URL=https://supabase-staging.malabdullah.cloud' "$target/.env" >/dev/null || {
  echo "SUPABASE_PUBLIC_URL is not the staging gateway." >&2
  exit 1
}
grep -Fx 'API_EXTERNAL_URL=https://supabase-staging.malabdullah.cloud/auth/v1' "$target/.env" >/dev/null || {
  echo "API_EXTERNAL_URL is not the staging Auth endpoint." >&2
  exit 1
}
grep -Fx 'SITE_URL=https://staging-barber.malabdullah.cloud' "$target/.env" >/dev/null || {
  echo "SITE_URL is not the staging application origin." >&2
  exit 1
}

echo "Supabase configuration matches $release at $expected and all compose images are pinned."
