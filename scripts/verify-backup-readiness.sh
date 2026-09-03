#!/bin/sh
set -eu

status_file=${1:-}
if [ -z "$status_file" ] || [ ! -f "$status_file" ]; then
  echo "Usage: scripts/verify-backup-readiness.sh /path/to/backup-status.json" >&2
  exit 1
fi

command -v jq >/dev/null 2>&1 || {
  echo "jq is required to verify backup readiness." >&2
  exit 1
}

now_epoch=${BACKUP_CHECK_NOW_EPOCH:-$(date -u +%s)}
case "$now_epoch" in
  *[!0-9]*|'') echo "BACKUP_CHECK_NOW_EPOCH must be an epoch timestamp." >&2; exit 1 ;;
esac

checked_at=$(jq -er '.checked_at | fromdateiso8601' "$status_file")
restore_at=$(jq -er '.latest_restore_drill.completed_at | fromdateiso8601' "$status_file")

if [ "$checked_at" -gt "$now_epoch" ] || [ $((now_epoch - checked_at)) -gt 300 ]; then
  echo "Backup status evidence is older than five minutes or is future-dated." >&2
  exit 1
fi

if [ "$restore_at" -gt "$now_epoch" ] || [ $((now_epoch - restore_at)) -gt 7948800 ]; then
  echo "Restore drill evidence is older than 92 days or is future-dated." >&2
  exit 1
fi

jq -e '
  .offsite_destination == true and
  .recoverable_point_age_seconds >= 0 and
  .recoverable_point_age_seconds <= 900 and
  .wal_archive.healthy == true and
  .wal_archive.lag_seconds >= 0 and
  .wal_archive.lag_seconds <= 900 and
  .base_backup.healthy == true and
  .base_backup.age_seconds >= 0 and
  .base_backup.age_seconds <= 90000 and
  .object_backup.healthy == true and
  .object_backup.age_seconds >= 0 and
  .object_backup.age_seconds <= 90000 and
  .latest_restore_drill.database_restored == true and
  .latest_restore_drill.storage_restored == true and
  .latest_restore_drill.achieved_rpo_seconds >= 0 and
  .latest_restore_drill.achieved_rpo_seconds <= 900 and
  .latest_restore_drill.achieved_rto_seconds >= 0 and
  .latest_restore_drill.achieved_rto_seconds <= 7200
' "$status_file" >/dev/null || {
  echo "Backup readiness failed the RPO, RTO, WAL, base, object, off-site, or restore gate." >&2
  exit 1
}

echo "Backup readiness verified: recoverable point <=15m, restore <=2h, and healthy off-site database/object backups."
