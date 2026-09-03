#!/bin/sh
set -eu

: "${STAGING_BACKUP_CHECK_URL:?STAGING_BACKUP_CHECK_URL is required}"
: "${STAGING_BACKUP_CHECK_TOKEN:?STAGING_BACKUP_CHECK_TOKEN is required}"

case "$STAGING_BACKUP_CHECK_URL" in
  https://*) ;;
  *) echo "Staging backup check URL must use HTTPS." >&2; exit 1 ;;
esac

response=$(mktemp)
evidence=$(mktemp)
cleanup() {
  rm -f "$response" "$evidence"
}
trap cleanup EXIT INT TERM

curl --fail-with-body --silent --show-error \
  --header "Authorization: Bearer $STAGING_BACKUP_CHECK_TOKEN" \
  --output "$response" \
  "$STAGING_BACKUP_CHECK_URL"

jq -e '
  .environment == "staging" and
  .status == "fresh" and
  (.backupId | type == "string" and length > 0) and
  (.checkedAt | type == "string" and length > 0)
' "$response" >/dev/null || {
  echo "Backup service did not attest to a fresh staging backup." >&2
  exit 1
}

jq '{environment, status, backupId, checkedAt, restoreTestedAt}' "$response" > "$evidence"
if [ -n "${BACKUP_EVIDENCE_OUTPUT:-}" ]; then
  case "$BACKUP_EVIDENCE_OUTPUT" in /*) ;; *)
    echo "BACKUP_EVIDENCE_OUTPUT must be an absolute path." >&2
    exit 1
  esac
  [ ! -e "$BACKUP_EVIDENCE_OUTPUT" ] || {
    echo "Refusing to overwrite backup evidence." >&2
    exit 1
  }
  umask 077
  cp "$evidence" "$BACKUP_EVIDENCE_OUTPUT"
fi

echo "Fresh staging backup attestation passed; no credentials were printed."
