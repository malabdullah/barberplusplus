#!/bin/sh
set -eu

: "${DOKPLOY_URL:?DOKPLOY_URL is required}"
: "${DOKPLOY_API_KEY:?DOKPLOY_API_KEY is required}"
: "${DOKPLOY_APPLICATION_ID:?DOKPLOY_APPLICATION_ID is required}"
: "${DEPLOY_IMAGE:?DEPLOY_IMAGE must contain the immutable image digest}"
: "${GHCR_PULL_USERNAME:?GHCR_PULL_USERNAME is required}"
: "${GHCR_PULL_TOKEN:?GHCR_PULL_TOKEN is required}"

deploy_timeout=${DOKPLOY_DEPLOY_TIMEOUT_SECONDS:-600}
case "$deploy_timeout" in
  ''|*[!0-9]*) echo "DOKPLOY_DEPLOY_TIMEOUT_SECONDS must be an integer" >&2; exit 1 ;;
esac

case "$DEPLOY_IMAGE" in
  *@sha256:*) ;;
  *) echo "DEPLOY_IMAGE must be pinned by sha256 digest" >&2; exit 1 ;;
esac

if [ "${DOKPLOY_DRY_RUN:-false}" = true ]; then
  echo "Dokploy dry-run validated an immutable image and required configuration; no API calls were made."
  exit 0
fi

current_application=$(curl --fail-with-body --silent --show-error \
  --get \
  --header "x-api-key: $DOKPLOY_API_KEY" \
  --data-urlencode "applicationId=$DOKPLOY_APPLICATION_ID" \
  "$DOKPLOY_URL/api/application.one")
previous_image=$(printf '%s' "$current_application" | jq -r '.dockerImage // empty')
if [ -n "${PREVIOUS_IMAGE_OUTPUT:-}" ]; then
  if [ -z "$previous_image" ]; then
    echo "Dokploy did not return the current dockerImage; refusing an unrecorded production change." >&2
    exit 1
  fi
  umask 077
  printf '%s\n' "$previous_image" > "$PREVIOUS_IMAGE_OUTPUT"
fi

payload=$(jq -n \
  --arg applicationId "$DOKPLOY_APPLICATION_ID" \
  --arg dockerImage "$DEPLOY_IMAGE" \
  --arg username "$GHCR_PULL_USERNAME" \
  --arg password "$GHCR_PULL_TOKEN" \
  '{applicationId: $applicationId, dockerImage: $dockerImage, username: $username, password: $password, registryUrl: "ghcr.io"}')

curl --fail-with-body --silent --show-error \
  --request POST \
  --header "x-api-key: $DOKPLOY_API_KEY" \
  --header 'content-type: application/json' \
  --data "$payload" \
  "$DOKPLOY_URL/api/application.saveDockerProvider"

curl --fail-with-body --silent --show-error \
  --request POST \
  --header "x-api-key: $DOKPLOY_API_KEY" \
  --header 'content-type: application/json' \
  --data "$(jq -n --arg applicationId "$DOKPLOY_APPLICATION_ID" --arg title "Deploy $DEPLOY_IMAGE" '{applicationId: $applicationId, title: $title}')" \
  "$DOKPLOY_URL/api/application.deploy"

elapsed=0
while [ "$elapsed" -lt "$deploy_timeout" ]; do
  sleep 5
  elapsed=$((elapsed + 5))
  application=$(curl --fail-with-body --silent --show-error \
    --get \
    --header "x-api-key: $DOKPLOY_API_KEY" \
    --data-urlencode "applicationId=$DOKPLOY_APPLICATION_ID" \
    "$DOKPLOY_URL/api/application.one")
  status=$(printf '%s' "$application" | jq -r '.applicationStatus // empty')
  case "$status" in
    done) echo "Dokploy deployment completed."; exit 0 ;;
    error) echo "Dokploy deployment failed." >&2; exit 1 ;;
    idle|running) ;;
    *) echo "Dokploy returned an unknown application status." >&2; exit 1 ;;
  esac
done

echo "Dokploy deployment did not complete within ${deploy_timeout}s." >&2
exit 1
