#!/bin/sh
set -eu

immutable_digest=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
release_sha=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
accepted_digest=sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc

DOKPLOY_URL=https://dokploy.invalid \
DOKPLOY_API_KEY=placeholder \
DOKPLOY_APPLICATION_ID=placeholder \
DEPLOY_IMAGE="ghcr.io/example/app@$immutable_digest" \
GHCR_PULL_USERNAME=placeholder \
GHCR_PULL_TOKEN=placeholder \
DOKPLOY_DRY_RUN=true \
sh scripts/dokploy-deploy.sh >/dev/null

if DOKPLOY_URL=https://dokploy.invalid \
  DOKPLOY_API_KEY=placeholder \
  DOKPLOY_APPLICATION_ID=placeholder \
  DEPLOY_IMAGE=ghcr.io/example/app:latest \
  GHCR_PULL_USERNAME=placeholder \
  GHCR_PULL_TOKEN=placeholder \
  DOKPLOY_DRY_RUN=true \
  sh scripts/dokploy-deploy.sh >/dev/null 2>&1; then
  echo 'Dokploy accepted a mutable image tag' >&2
  exit 1
fi

mock_bin=$(mktemp -d)
github_output=$(mktemp)
trap 'rm -rf "$mock_bin"; rm -f "$github_output"' EXIT

sed \
  -e "s|__RELEASE_SHA__|$release_sha|g" \
  -e "s|__ACCEPTED_DIGEST__|$accepted_digest|g" \
  > "$mock_bin/curl" <<'MOCK_CURL'
#!/bin/sh
case "$*" in
  *'/actions/artifacts?name=accepted-release-'*)
    printf '%s' '{"artifacts":[{"id":99,"name":"accepted-release-__RELEASE_SHA__","expired":false,"workflow_run":{"id":42}}]}'
    ;;
  *'/actions/runs/42'*)
    printf '%s' '{"id":42,"conclusion":"success","path":".github/workflows/deploy-staging.yml"}'
    ;;
  *'/actions/artifacts/99/zip'*)
    printf '%s' 'mock-zip'
    ;;
  *)
    echo "Unexpected GitHub API request: $*" >&2
    exit 1
    ;;
esac
MOCK_CURL

sed \
  -e "s|__RELEASE_SHA__|$release_sha|g" \
  -e "s|__ACCEPTED_DIGEST__|$accepted_digest|g" \
  > "$mock_bin/unzip" <<'MOCK_UNZIP'
#!/bin/sh
printf '%s' '{"commit":"__RELEASE_SHA__","digest":"__ACCEPTED_DIGEST__","migration":"20260902095726_trusted_authorization_and_cron"}'
MOCK_UNZIP

chmod +x "$mock_bin/curl" "$mock_bin/unzip"
PATH="$mock_bin:/usr/bin:/bin" \
GITHUB_API_URL=https://api.github.invalid \
GITHUB_REPOSITORY=example/app \
GITHUB_TOKEN=placeholder \
GITHUB_OUTPUT="$github_output" \
RELEASE_SHA="$release_sha" \
sh scripts/resolve-accepted-release.sh

grep -Fx "digest=$accepted_digest" "$github_output" >/dev/null

echo 'CI/CD helper tests passed.'
