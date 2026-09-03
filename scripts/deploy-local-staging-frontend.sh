#!/bin/sh
set -eu

: "${DEPLOY_IMAGE:?DEPLOY_IMAGE is required}"
: "${DEPLOY_SHA:?DEPLOY_SHA is required}"
: "${APP_URL:?APP_URL is required}"
: "${STAGING_SUPABASE_URL:?STAGING_SUPABASE_URL is required}"

case "$DEPLOY_IMAGE" in
  ghcr.io/malabdullah/barberplusplus@sha256:*) ;;
  *) echo "DEPLOY_IMAGE must be the immutable Barber++ GHCR image." >&2; exit 1 ;;
esac

status_output=$(npx supabase status -o env 2>/dev/null)
publishable_key=$(printf '%s\n' "$status_output" | awk -F= '
  $1 == "PUBLISHABLE_KEY" {
    value = substr($0, index($0, "=") + 1)
    gsub(/^"|"$/, "", value)
    print value
    exit
  }
')
[ -n "$publishable_key" ] || { echo "Unable to read the local browser-safe Supabase key." >&2; exit 1; }

current=barber-staging-frontend
previous=barber-staging-frontend-previous

docker pull "$DEPLOY_IMAGE" >/dev/null
docker image inspect "$DEPLOY_IMAGE" >/dev/null

if docker inspect "$previous" >/dev/null 2>&1; then
  echo "A previous staging container is still retained; resolve it before deploying again." >&2
  exit 1
fi

had_current=false
if docker inspect "$current" >/dev/null 2>&1; then
  had_current=true
  docker stop "$current" >/dev/null
  docker rename "$current" "$previous"
fi

rollback() {
  docker rm -f "$current" >/dev/null 2>&1 || true
  if [ "$had_current" = true ] && docker inspect "$previous" >/dev/null 2>&1; then
    docker rename "$previous" "$current"
    docker start "$current" >/dev/null
  fi
}
trap rollback EXIT INT TERM

docker run --detach \
  --name "$current" \
  --restart unless-stopped \
  --publish 127.0.0.1:8080:8080 \
  --env APP_ENV=staging \
  --env APP_URL="$APP_URL" \
  --env SUPABASE_PUBLIC_URL="$STAGING_SUPABASE_URL" \
  --env SUPABASE_PUBLISHABLE_KEY="$publishable_key" \
  "$DEPLOY_IMAGE" >/dev/null

attempt=0
while [ "$attempt" -lt 60 ]; do
  health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$current")
  if [ "$health" = healthy ] && curl --fail --silent http://127.0.0.1:8080/healthz >/dev/null; then
    trap - EXIT INT TERM
    echo "Deployed the immutable staging frontend image; the previous container is retained pending acceptance."
    exit 0
  fi
  [ "$health" != unhealthy ] || break
  sleep 2
  attempt=$((attempt + 1))
done

echo "New staging frontend did not become healthy; restoring the previous container." >&2
exit 1
