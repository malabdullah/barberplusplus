#!/bin/sh
set -eu

: "${SMOKE_APP_URL:?SMOKE_APP_URL is required}"
: "${EXPECTED_ENV:?EXPECTED_ENV is required}"
: "${EXPECTED_RELEASE:?EXPECTED_RELEASE is required}"

if [ -n "${ACCESS_CLIENT_ID:-}" ] || [ -n "${ACCESS_CLIENT_SECRET:-}" ]; then
  : "${ACCESS_CLIENT_ID:?Both Cloudflare Access service-token values are required}"
  : "${ACCESS_CLIENT_SECRET:?Both Cloudflare Access service-token values are required}"
  runtime_config=$(curl --fail-with-body --silent --show-error \
    --header "CF-Access-Client-Id: $ACCESS_CLIENT_ID" \
    --header "CF-Access-Client-Secret: $ACCESS_CLIENT_SECRET" \
    "$SMOKE_APP_URL/runtime-config.js")
else
  runtime_config=$(curl --fail-with-body --silent --show-error \
    "$SMOKE_APP_URL/runtime-config.js")
fi

printf '%s' "$runtime_config" | grep -F "environment: '$EXPECTED_ENV'" >/dev/null
printf '%s' "$runtime_config" | grep -F "release: '$EXPECTED_RELEASE'" >/dev/null

headers=$(mktemp)
trap 'rm -f "$headers"' EXIT
if [ -n "${ACCESS_CLIENT_ID:-}" ]; then
  curl --fail-with-body --silent --show-error --head \
    --header "CF-Access-Client-Id: $ACCESS_CLIENT_ID" \
    --header "CF-Access-Client-Secret: $ACCESS_CLIENT_SECRET" \
    --output /dev/null --dump-header "$headers" "$SMOKE_APP_URL/"
else
  curl --fail-with-body --silent --show-error --head \
    --output /dev/null --dump-header "$headers" "$SMOKE_APP_URL/"
fi

grep -i '^content-security-policy:' "$headers" >/dev/null
grep -i '^x-content-type-options: nosniff' "$headers" >/dev/null
grep -i '^referrer-policy:' "$headers" >/dev/null

if [ "$EXPECTED_ENV" = staging ]; then
  grep -i '^x-robots-tag: noindex, nofollow' "$headers" >/dev/null
fi
