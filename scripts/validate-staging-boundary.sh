#!/bin/sh
set -eu

: "${STAGING_APP_URL:?STAGING_APP_URL is required}"
: "${STAGING_SUPABASE_URL:?STAGING_SUPABASE_URL is required}"
: "${EXPECTED_RELEASE:?EXPECTED_RELEASE is required}"
: "${ACCESS_CLIENT_ID:?ACCESS_CLIENT_ID is required}"
: "${ACCESS_CLIENT_SECRET:?ACCESS_CLIENT_SECRET is required}"

[ "$STAGING_APP_URL" = "https://staging.barber.malabdullah.cloud" ] || {
  echo "Refusing to test a non-staging application hostname." >&2
  exit 1
}
[ "$STAGING_SUPABASE_URL" = "https://supabase-staging.malabdullah.cloud" ] || {
  echo "Refusing to test a non-staging Supabase hostname." >&2
  exit 1
}

tmp_dir=$(mktemp -d)
cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT INT TERM

request_status() {
  curl --silent --show-error \
    --dump-header "$tmp_dir/headers" \
    --output "$tmp_dir/body" \
    --write-out '%{http_code}' "$@"
}

expect_access_block() {
  status=$(request_status "$1")
  case "$status" in
    301|302|303|307|308)
      grep -Eiq '^location:.*cloudflareaccess\.com' "$tmp_dir/headers" || {
        echo "Block response for $1 was not issued by Cloudflare Access." >&2
        exit 1
      }
      ;;
    401|403)
      if ! grep -Eiq 'cloudflare|access' "$tmp_dir/headers" "$tmp_dir/body"; then
        echo "Denial for $1 was not identifiable as Cloudflare Access." >&2
        exit 1
      fi
      ;;
    *) echo "Expected Cloudflare Access to block $1; received HTTP $status" >&2; exit 1 ;;
  esac
}

expect_access_block "$STAGING_APP_URL/runtime-config.js"
expect_access_block "$STAGING_SUPABASE_URL/rest/v1/"
expect_access_block "$STAGING_SUPABASE_URL/functions/v1/send-whatsapp-message"

SMOKE_APP_URL=$STAGING_APP_URL \
EXPECTED_ENV=staging \
ACCESS_CLIENT_ID=$ACCESS_CLIENT_ID \
ACCESS_CLIENT_SECRET=$ACCESS_CLIENT_SECRET \
sh scripts/smoke-environment.sh

status=$(request_status \
  --request GET \
  "$STAGING_SUPABASE_URL/functions/v1/whatsapp-webhook?hub.mode=subscribe&hub.verify_token=invalid&hub.challenge=test")
[ "$status" = 403 ] || {
  echo "Webhook bypass/signature boundary returned HTTP $status instead of 403." >&2
  exit 1
}
grep -Fx 'Verification failed' "$tmp_dir/body" >/dev/null || {
  echo "Webhook path did not reach the signature-protected function." >&2
  exit 1
}

status=$(request_status \
  --request POST \
  --header 'content-type: application/json' \
  --header 'x-hub-signature-256: sha256=invalid' \
  --data '{"object":"whatsapp_business_account","entry":[]}' \
  "$STAGING_SUPABASE_URL/functions/v1/whatsapp-webhook")
[ "$status" = 401 ] || {
  echo "Invalid webhook signature returned HTTP $status instead of 401." >&2
  exit 1
}
grep -Fx 'Invalid signature' "$tmp_dir/body" >/dev/null || {
  echo "Webhook path did not reach the signature-protected function." >&2
  exit 1
}

status=$(request_status \
  --request POST \
  --header 'content-type: application/json' \
  --data '{"version":"5.1","action":"ping"}' \
  "$STAGING_SUPABASE_URL/functions/v1/whatsapp-flow-endpoint")
[ "$status" = 200 ] || {
  echo "Flow endpoint returned unexpected HTTP $status." >&2
  exit 1
}
grep -Eq '"error"[[:space:]]*:[[:space:]]*true' "$tmp_dir/body" || {
  echo "Unencrypted Flow request was not rejected." >&2
  exit 1
}

echo "Staging Access, webhook, Flow, release, and security-header boundaries passed."
