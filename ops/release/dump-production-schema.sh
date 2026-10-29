#!/usr/bin/env bash
set -euo pipefail
export PGHOST='' PGPORT='' PGUSER='' PGPASSWORD='' PGDATABASE=''
export EXTRA_FLAGS='--schema public' EXTRA_SED='/^--/d'
pg_dump() {
  docker exec -e 'PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=20000' supabase-db pg_dump -U postgres -d postgres "$@"
}
export -f pg_dump
exec bash /usr/local/lib/barber-release/dump-schema.sh
