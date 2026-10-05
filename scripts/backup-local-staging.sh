#!/bin/sh
set -eu

: "${STAGING_BACKUP_DIR:?STAGING_BACKUP_DIR is required}"
: "${BACKUP_EVIDENCE_OUTPUT:?BACKUP_EVIDENCE_OUTPUT is required}"
: "${DEPLOY_SHA:?DEPLOY_SHA is required}"

case "$STAGING_BACKUP_DIR" in
  /Users/malabdullah/actions-runner-barber-staging/_backups) ;;
  *) echo "Refusing to back up outside the isolated staging backup directory." >&2; exit 1 ;;
esac
case "$DEPLOY_SHA" in
  *[!0-9a-f]*|'') echo "DEPLOY_SHA must be a lowercase commit SHA." >&2; exit 1 ;;
esac
[ "${#DEPLOY_SHA}" -eq 40 ] || { echo "DEPLOY_SHA must contain 40 characters." >&2; exit 1; }
[ ! -e "$BACKUP_EVIDENCE_OUTPUT" ] || { echo "Refusing to overwrite backup evidence." >&2; exit 1; }

umask 077
timestamp=$(date -u '+%Y%m%dT%H%M%SZ')
backup_id="staging-$timestamp-$DEPLOY_SHA"
backup_path="$STAGING_BACKUP_DIR/$backup_id"
mkdir -p "$backup_path"

database_file="$backup_path/database.dump"
storage_file="$backup_path/storage.tar.gz"

docker exec supabase_db_barber-plus-plus \
  pg_dump --username postgres --dbname postgres --format=custom > "$database_file"
docker exec supabase_storage_barber-plus-plus \
  tar -czf - -C /mnt . > "$storage_file"

[ -s "$database_file" ] || { echo "Staging database backup is empty." >&2; exit 1; }
[ -s "$storage_file" ] || { echo "Staging Storage backup is empty." >&2; exit 1; }

database_sha=$(shasum -a 256 "$database_file" | awk '{print $1}')
storage_sha=$(shasum -a 256 "$storage_file" | awk '{print $1}')
database_bytes=$(wc -c < "$database_file" | tr -d '[:space:]')
storage_bytes=$(wc -c < "$storage_file" | tr -d '[:space:]')
checked_at=$(date -u '+%Y-%m-%dT%H:%M:%SZ')

jq -n \
  --arg environment staging \
  --arg status fresh \
  --arg backupId "$backup_id" \
  --arg checkedAt "$checked_at" \
  --arg release "$DEPLOY_SHA" \
  --arg databaseSha256 "$database_sha" \
  --arg storageSha256 "$storage_sha" \
  --argjson databaseBytes "$database_bytes" \
  --argjson storageBytes "$storage_bytes" \
  '{environment: $environment, status: $status, backupId: $backupId,
    checkedAt: $checkedAt, release: $release,
    database: {sha256: $databaseSha256, bytes: $databaseBytes},
    storage: {sha256: $storageSha256, bytes: $storageBytes}}' \
  > "$BACKUP_EVIDENCE_OUTPUT"

chmod 600 "$database_file" "$storage_file" "$BACKUP_EVIDENCE_OUTPUT"
echo "Created a protected local staging database and Storage backup; only checksum evidence may be uploaded."
