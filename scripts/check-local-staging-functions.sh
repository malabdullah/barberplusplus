#!/bin/sh
set -eu

runner_root=/Users/malabdullah/actions-runner-barber-staging
cli_version=$(node -p "require('./node_modules/supabase/package.json').version")
supabase_binary="$runner_root/_tools/supabase-$cli_version"
[ -x "$supabase_binary" ] || supabase_binary="$(pwd -P)/node_modules/@supabase/cli-darwin-arm64/bin/supabase"
[ -x "$supabase_binary" ] || { echo 'A pinned Supabase CLI binary is required for the Function health check.' >&2; exit 1; }

status_env=$("$supabase_binary" status --workdir "$(pwd -P)" -o env)
publishable_key=$(printf '%s\n' "$status_env" | sed -n 's/^PUBLISHABLE_KEY="\(.*\)"$/\1/p')
[ -n "$publishable_key" ] || publishable_key=$(printf '%s\n' "$status_env" | sed -n 's/^ANON_KEY="\(.*\)"$/\1/p')
[ -n "$publishable_key" ] || { echo 'Could not obtain the isolated staging publishable key.' >&2; exit 1; }

response_file=$(mktemp)
trap 'rm -f "$response_file"' EXIT
attempt=0
while [ "$attempt" -lt 60 ]; do
  function_http=$(curl --silent --output "$response_file" --write-out '%{http_code}' \
    --header "apikey: $publishable_key" \
    --header "Authorization: Bearer $publishable_key" \
    http://127.0.0.1:54321/functions/v1/get-kuwait-governorates || true)
  if [ "$function_http" = 200 ] && jq -e '.success == true' "$response_file" >/dev/null 2>&1; then
    echo 'Staging Edge Functions passed the authenticated readiness probe.'
    exit 0
  fi
  sleep 1
  attempt=$((attempt + 1))
done

echo 'Staging Edge Functions failed the authenticated readiness probe.' >&2
exit 1
