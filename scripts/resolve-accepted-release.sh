#!/bin/sh
set -eu

: "${GITHUB_API_URL:?GITHUB_API_URL is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
: "${GITHUB_TOKEN:?GITHUB_TOKEN is required}"
: "${RELEASE_SHA:?RELEASE_SHA is required}"

case "$RELEASE_SHA" in
  *[!0-9a-f]*|'') echo "RELEASE_SHA must be a lowercase hexadecimal commit SHA" >&2; exit 1 ;;
esac
test "${#RELEASE_SHA}" -eq 40 || { echo "RELEASE_SHA must contain 40 hexadecimal characters" >&2; exit 1; }

api_get() {
  curl --fail-with-body --silent --show-error --location \
    --header "Authorization: Bearer $GITHUB_TOKEN" \
    --header 'Accept: application/vnd.github+json' \
    --header 'X-GitHub-Api-Version: 2026-03-10' \
    "$1"
}

artifact_name="accepted-release-$RELEASE_SHA"
artifacts=$(api_get "$GITHUB_API_URL/repos/$GITHUB_REPOSITORY/actions/artifacts?name=$artifact_name&per_page=100")
artifact_id=$(printf '%s' "$artifacts" | jq -r --arg name "$artifact_name" '[.artifacts[] | select(.name == $name and .expired == false)] | sort_by(.id) | reverse | .[0].id // empty')
test -n "$artifact_id" || { echo "No unexpired $artifact_name artifact exists" >&2; exit 1; }
run_id=$(printf '%s' "$artifacts" | jq -r --argjson id "$artifact_id" '.artifacts[] | select(.id == $id) | .workflow_run.id // empty')
test -n "$run_id" || { echo "The accepted release artifact has no workflow run" >&2; exit 1; }

run=$(api_get "$GITHUB_API_URL/repos/$GITHUB_REPOSITORY/actions/runs/$run_id")
printf '%s' "$run" | jq -e '.conclusion == "success" and .path == ".github/workflows/deploy-staging.yml"' >/dev/null || {
  echo "The accepted release artifact did not come from a successful staging workflow" >&2
  exit 1
}

archive=$(mktemp)
manifest=$(mktemp)
trap 'rm -f "$archive" "$manifest"' EXIT
api_get "$GITHUB_API_URL/repos/$GITHUB_REPOSITORY/actions/artifacts/$artifact_id/zip" > "$archive"
unzip -p "$archive" accepted-release.json > "$manifest"

jq -e --arg commit "$RELEASE_SHA" '.commit == $commit and (.digest | test("^sha256:[0-9a-f]{64}$"))' "$manifest" >/dev/null
digest=$(jq -r '.digest' "$manifest")

if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "digest=$digest" >> "$GITHUB_OUTPUT"
else
  printf '%s\n' "$digest"
fi
