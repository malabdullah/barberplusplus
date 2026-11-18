#!/usr/bin/env bash
# Runs only inside the disposable GitHub-hosted pilot workflow.
set -euo pipefail
test "${GITHUB_ACTIONS:-}" = true
test "${RUNNER_ENVIRONMENT:-}" = github-hosted
test "${GITHUB_REF:-}" = refs/heads/codex/release-paired-test-20261118
test "${GITHUB_WORKFLOW:-}" = 'Barber paired Test candidate'
test "$(git rev-parse HEAD)" = "$GITHUB_SHA"

mode=${1:?}
kind=${2:?}
destination=${3:?}
case "$kind" in application|browser|database) ;; *) exit 2;; esac
case "$mode" in qualify|repeat) ;; *) exit 2;; esac
mkdir -p "$destination"

proof() {
  node ops/release-shadow/paired/snapshot.mjs "$kind"
}

now() { node -p 'Date.now()'; }
started=$(now)
trap 'if [[ "$kind" != application && -f .local-test/initialized.json ]]; then npm run local:stop >/dev/null; fi' EXIT

if [[ "$kind" == application ]]; then
  npm ci
  npm run check
  npm run test:production-image
  python3 ops/release/test-functions-image.py
else
  npm run local:setup
  if [[ "$kind" == browser ]]; then
    node ops/release/export-local-browser-env.mjs
    node scripts/check-apple-popup-policy.mjs
    npm run test:e2e
    npm run test:e2e:qa
  else
    npm run check:migrations
    npx --no-install supabase test db
    npm run check:schema
    python3 ops/release/test-postgres-image.py
    python3 ops/account-deletion/rehearse-platform.py
    node scripts/probe-local-backend.mjs
    node scripts/probe-local-invitations.mjs
    node scripts/probe-customer-email.mjs
    node scripts/probe-customer-social.mjs
    node scripts/probe-customer-smtp.mjs
    node scripts/verify-local-lifecycle.mjs
  fi
fi
finished=$(now)

proof > "$destination/$mode-$kind-inputs.json"
node -e 'const [mode,kind,start,finish]=process.argv.slice(1); console.log(JSON.stringify({mode,kind,start:Number(start),finish:Number(finish),elapsedMs:Number(finish)-Number(start),passed:true}))' \
  "$mode" "$kind" "$started" "$finished" > "$destination/$mode-$kind-timing.json"

# No auth tokens, raw diagnostics, or volume data leave the isolated runner.
# The two checkouts cannot share a local Supabase profile or persisted state.
if [[ "$mode" == qualify && "$kind" != application ]]; then
  npm exec -- supabase stop --project-id barber-local-test --no-backup
  trap - EXIT
  if docker ps -a --format '{{.Names}}' | grep -q 'barber-local-test'; then
    echo 'Synthetic runner did not clear its Test containers'; exit 1
  fi
  # Supabase's stop does not own our separate scratch-checkout marker.
  owner=barber-local-test-workspace-owner
  if docker volume inspect "$owner" >/dev/null 2>&1; then
    identity=$(docker volume inspect --format '{{index .Labels "barber.workspace"}}|{{index .Labels "barber.project"}}' "$owner")
    test "$identity" = "$(pwd -P)|barber-local-test"
    docker volume rm "$owner" >/dev/null
  fi
fi
