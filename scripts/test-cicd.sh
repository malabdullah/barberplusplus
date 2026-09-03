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
migration_evidence=$(mktemp)
trap 'rm -rf "$mock_bin"; rm -f "$github_output" "$migration_evidence"' EXIT

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

cat > "$mock_bin/npx" <<'MOCK_NPX'
#!/bin/sh
[ "$1 $2 $3" = 'supabase migration list' ] || exit 1
case "${MOCK_MIGRATION_HISTORY:-safe}" in
  safe)
    printf '%s\n' '{"migrations":[{"local":"20260901000000","remote":"20260901000000","time":"2026-09-01 00:00:00"},{"local":"20260903111635","remote":null,"time":"2026-09-03 11:16:35"}]}'
    ;;
  missing-baseline)
    printf '%s\n' '{"migrations":[{"local":"20260901000000","remote":null,"time":"2026-09-01 00:00:00"}]}'
    ;;
  remote-only)
    printf '%s\n' '{"migrations":[{"local":"20260901000000","remote":"20260901000000","time":"2026-09-01 00:00:00"},{"local":null,"remote":"20200101000000","time":"2020-01-01 00:00:00"}]}'
    ;;
esac
MOCK_NPX
chmod +x "$mock_bin/npx"

PATH="$mock_bin:$PATH" \
SUPABASE_DB_URL=postgresql://production.invalid/database \
MIGRATION_HISTORY_EVIDENCE="$migration_evidence" \
sh scripts/verify-production-migration-history.sh >/dev/null
jq -e '.verified_baseline == "20260901000000" and .decision == "PASS"' "$migration_evidence" >/dev/null

if PATH="$mock_bin:$PATH" \
  MOCK_MIGRATION_HISTORY=missing-baseline \
  SUPABASE_DB_URL=postgresql://production.invalid/database \
  MIGRATION_HISTORY_EVIDENCE="$migration_evidence" \
  sh scripts/verify-production-migration-history.sh >/dev/null 2>&1; then
  echo 'Migration history check accepted a missing production baseline.' >&2
  exit 1
fi

if PATH="$mock_bin:$PATH" \
  MOCK_MIGRATION_HISTORY=remote-only \
  SUPABASE_DB_URL=postgresql://production.invalid/database \
  MIGRATION_HISTORY_EVIDENCE="$migration_evidence" \
  sh scripts/verify-production-migration-history.sh >/dev/null 2>&1; then
  echo 'Migration history check accepted an unexpected remote-only migration.' >&2
  exit 1
fi

echo 'CI/CD helper tests passed.'
