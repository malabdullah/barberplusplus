#!/bin/sh
set -eu

fail() { echo "staging VPS deploy preflight: $1" >&2; exit 1; }
require_var() {
  eval "value=\${$1-}"
  [ -n "$value" ] || fail "missing required environment variable: $1"
  case "$value" in *replace*|*placeholder*|*example.com*) fail "$1 contains a placeholder" ;; esac
}

[ -f supabase/.baseline-ready ] || fail 'database baseline is not approved'
[ -f supabase/schema.expected.sql ] || fail 'expected schema is absent'
for command_name in curl jq node npm npx; do
  command -v "$command_name" >/dev/null 2>&1 || fail "missing required command: $command_name"
done
for variable in APP_URL STAGING_SUPABASE_URL DEPLOY_SHA FRONTEND_IMAGE FUNCTIONS_IMAGE DOKPLOY_URL DOKPLOY_PROJECT_ID DOKPLOY_ENVIRONMENT_ID DOKPLOY_FRONTEND_APPLICATION_ID DOKPLOY_SUPABASE_COMPOSE_ID STAGING_VPS_AUTOMATION_READY; do
  require_var "$variable"
done

[ "$APP_URL" = 'https://staging-barber.malabdullah.cloud' ] || fail 'APP_URL is not the dedicated staging origin'
[ "$STAGING_SUPABASE_URL" = 'https://supabase-staging.malabdullah.cloud' ] || fail 'STAGING_SUPABASE_URL is not the dedicated staging origin'
[ "$DOKPLOY_URL" = 'http://127.0.0.1:3000' ] || fail 'Dokploy must remain reachable only through the VPS loopback interface'
[ "$DOKPLOY_PROJECT_ID" = 'LjKnNCq96dgPJacpmYaQ4' ] || fail 'unexpected Dokploy project ID'
[ "$DOKPLOY_ENVIRONMENT_ID" = 'rc8vJw9uMIQqoGFjeJYpc' ] || fail 'unexpected Dokploy staging environment ID'
[ "$STAGING_VPS_AUTOMATION_READY" = 'true' ] || fail 'STAGING_VPS_AUTOMATION_READY is not true'

case "$DEPLOY_SHA" in *[!0-9a-f]*|'') fail 'DEPLOY_SHA must be a lowercase full commit SHA' ;; esac
[ "${#DEPLOY_SHA}" -eq 40 ] || fail 'DEPLOY_SHA must contain 40 characters'
validate_image() {
  image=$1
  repository=$2
  case "$image" in "$repository"@sha256:*) ;; *) fail "$3 must use the expected GHCR repository and an immutable digest" ;; esac
  digest=${image#*@sha256:}
  case "$digest" in *[!0-9a-f]*|'') fail "$3 digest is not lowercase hexadecimal" ;; esac
  [ "${#digest}" -eq 64 ] || fail "$3 digest must contain 64 hexadecimal characters"
}
validate_image "$FRONTEND_IMAGE" 'ghcr.io/malabdullah/barberplusplus' FRONTEND_IMAGE
validate_image "$FUNCTIONS_IMAGE" 'ghcr.io/malabdullah/barberplusplus-functions' FUNCTIONS_IMAGE
for resource_id in "$DOKPLOY_FRONTEND_APPLICATION_ID" "$DOKPLOY_SUPABASE_COMPOSE_ID"; do
  case "$resource_id" in *[!A-Za-z0-9_-]*|'') fail 'Dokploy resource ID is invalid' ;; esac
done

echo 'staging VPS deployment contract passed; no secret values were printed'
