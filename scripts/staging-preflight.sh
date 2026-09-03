#!/bin/sh
set -eu

fail() {
  echo "staging preflight: $1" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "missing required command: $1"
}

require_var() {
  eval "value=\${$1-}"
  [ -n "$value" ] || fail "missing required environment variable: $1"
  case "$value" in
    *replace*|*placeholder*|*example.com*) fail "$1 still contains a placeholder" ;;
  esac
}

[ -f supabase/.baseline-ready ] || fail \
  "supabase/.baseline-ready is absent; authoritative migrations and seed are not approved"
[ -f supabase/schema.expected.sql ] || fail \
  "supabase/schema.expected.sql is absent"
[ -d supabase/tests ] || fail "supabase/tests is absent"

for command_name in curl docker jq launchctl node npm npx plutil shasum; do
  require_command "$command_name"
done

for variable in \
  APP_URL STAGING_SUPABASE_URL DEPLOY_IMAGE DEPLOY_SHA \
  STAGING_FUNCTION_ENV_FILE STAGING_FUNCTION_STATE_DIR STAGING_BACKUP_DIR \
  ACCESS_CLIENT_ID ACCESS_CLIENT_SECRET
do
  require_var "$variable"
done

[ "$APP_URL" = "https://staging-barber.malabdullah.cloud" ] || fail \
  "APP_URL must be the dedicated staging hostname"
[ "$STAGING_SUPABASE_URL" = "https://supabase-staging.malabdullah.cloud" ] || fail \
  "STAGING_SUPABASE_URL must be the dedicated staging hostname"

case "$DEPLOY_IMAGE" in
  ghcr.io/malabdullah/barberplusplus@sha256:*) ;;
  *) fail "DEPLOY_IMAGE must use the Barber++ GHCR repository and an immutable digest" ;;
esac
case "$DEPLOY_IMAGE" in
  *supabase.malabdullah.cloud*|*pqaidfykknoiqmosfvnb*)
    fail "DEPLOY_IMAGE references a known production endpoint"
    ;;
esac
case "$DEPLOY_SHA" in
  *[!0-9a-f]*|'') fail "DEPLOY_SHA must be a lowercase commit SHA" ;;
esac
[ "${#DEPLOY_SHA}" -eq 40 ] || fail "DEPLOY_SHA must contain 40 characters"

runner_root=/Users/malabdullah/actions-runner-barber-staging
case "$STAGING_FUNCTION_ENV_FILE" in
  "$runner_root"/.secrets/*) ;;
  *) fail "STAGING_FUNCTION_ENV_FILE must be inside the protected staging runner directory" ;;
esac
case "$STAGING_FUNCTION_STATE_DIR" in
  "$runner_root"/_state/*) ;;
  *) fail "STAGING_FUNCTION_STATE_DIR must be inside the staging runner state directory" ;;
esac
case "$STAGING_BACKUP_DIR" in
  "$runner_root"/_backups) ;;
  *) fail "STAGING_BACKUP_DIR must be the isolated local staging backup directory" ;;
esac
[ -f "$STAGING_FUNCTION_ENV_FILE" ] || fail "staging Edge Function environment file is absent"

release=$(tr -d '[:space:]' < ops/supabase/self-hosted.release)
case "$release" in self-hosted/v[0-9]*.[0-9]*.[0-9]*) ;; *) fail "invalid Supabase release pin" ;; esac
release_commit=$(tr -d '[:space:]' < ops/supabase/self-hosted.commit)
case "$release_commit" in *[!0-9a-f]*|'') fail "invalid Supabase commit pin" ;; esac
[ "${#release_commit}" -eq 40 ] || fail "Supabase commit pin must contain 40 characters"

docker info >/dev/null 2>&1 || fail "Docker Desktop is not available to the staging runner"
docker inspect supabase_db_barber-plus-plus >/dev/null 2>&1 || fail "isolated staging database container is absent"
docker inspect supabase_storage_barber-plus-plus >/dev/null 2>&1 || fail "isolated staging Storage container is absent"

echo "staging preflight passed for the isolated local Mac stack; secrets were not printed"
