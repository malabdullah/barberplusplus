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

require_command curl
require_command jq

for variable in \
  APP_URL STAGING_SUPABASE_URL STAGING_DB_URL \
  STAGING_FUNCTION_DEPLOY_HOOK STAGING_FUNCTION_DEPLOY_SECRET \
  STAGING_BACKUP_CHECK_URL STAGING_BACKUP_CHECK_TOKEN \
  DOKPLOY_URL DOKPLOY_API_KEY DOKPLOY_APPLICATION_ID \
  GHCR_PULL_USERNAME GHCR_PULL_TOKEN \
  ACCESS_CLIENT_ID ACCESS_CLIENT_SECRET
do
  require_var "$variable"
done

[ "$APP_URL" = "https://staging-barber.malabdullah.cloud" ] || fail \
  "APP_URL must be the dedicated staging hostname"
[ "$STAGING_SUPABASE_URL" = "https://supabase-staging.malabdullah.cloud" ] || fail \
  "STAGING_SUPABASE_URL must be the dedicated staging hostname"

case "$DOKPLOY_URL" in https://*) ;; *) fail "DOKPLOY_URL must use HTTPS" ;; esac
case "$STAGING_FUNCTION_DEPLOY_HOOK" in https://*) ;; *) fail "staging deploy hook must use HTTPS" ;; esac
case "$STAGING_BACKUP_CHECK_URL" in https://*) ;; *) fail "staging backup check URL must use HTTPS" ;; esac
case "$STAGING_DB_URL" in
  *pqaidfykknoiqmosfvnb*|*supabase.malabdullah.cloud*)
    fail "STAGING_DB_URL references a known production endpoint"
    ;;
  postgres://*|postgresql://*) ;;
  *) fail "STAGING_DB_URL must be a PostgreSQL connection URL" ;;
esac

if [ -n "${PRODUCTION_DB_URL:-}" ] && [ "$STAGING_DB_URL" = "$PRODUCTION_DB_URL" ]; then
  fail "staging and production database URLs are identical"
fi
if [ -n "${PRODUCTION_DOKPLOY_APPLICATION_ID:-}" ] && \
  [ "$DOKPLOY_APPLICATION_ID" = "$PRODUCTION_DOKPLOY_APPLICATION_ID" ]; then
  fail "staging and production Dokploy application IDs are identical"
fi

release=$(tr -d '[:space:]' < ops/supabase/self-hosted.release)
case "$release" in self-hosted/v[0-9]*.[0-9]*.[0-9]*) ;; *) fail "invalid Supabase release pin" ;; esac
release_commit=$(tr -d '[:space:]' < ops/supabase/self-hosted.commit)
case "$release_commit" in *[!0-9a-f]*|'') fail "invalid Supabase commit pin" ;; esac
[ "${#release_commit}" -eq 40 ] || fail "Supabase commit pin must contain 40 characters"

echo "staging preflight passed for isolated hosts; secrets were not printed"
