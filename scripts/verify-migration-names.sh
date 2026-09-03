#!/bin/sh
set -eu

failed=0
for migration in supabase/migrations/*.sql; do
  name=$(basename "$migration")
  case "$name" in
    [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]_*.sql) ;;
    *)
      echo "Migration is not timestamped: $name" >&2
      failed=1
      ;;
  esac
done

exit "$failed"
