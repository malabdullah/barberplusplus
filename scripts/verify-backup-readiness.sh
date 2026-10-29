#!/bin/sh
set -eu

status_file=${1:-}
if [ -z "$status_file" ] || [ ! -f "$status_file" ]; then
  echo "Usage: scripts/verify-backup-readiness.sh /path/to/backup-status.json" >&2
  exit 1
fi

script_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
exec python3 "$script_dir/../ops/release/backup_policy.py" "$status_file"
