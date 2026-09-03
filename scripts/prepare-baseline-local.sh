#!/bin/sh
set -eu

repo_root=$(git rev-parse --show-toplevel)
lab_root="$repo_root/.baseline-local"
network_name=barber-baseline-local
db_container=supabase_db_baseline-local
excluded_services=gotrue,realtime,storage-api,imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor
status_file=$(mktemp)
trap 'rm -f "$status_file"' EXIT

command -v docker >/dev/null 2>&1 || {
  echo "Docker Desktop is required." >&2
  exit 1
}

docker info >/dev/null 2>&1 || {
  echo "Docker Desktop is not running or is inaccessible." >&2
  exit 1
}

if ! docker network inspect "$network_name" >/dev/null 2>&1; then
  docker network create \
    --driver bridge \
    --opt com.docker.network.bridge.host_binding_ipv4=127.0.0.1 \
    "$network_name" >/dev/null
fi

if [ ! -f "$lab_root/supabase/config.toml" ]; then
  mkdir -p "$lab_root"
  npx supabase --workdir "$lab_root" init
fi

perl -0pi -e \
  's/(\[db\.network_restrictions\][^[]*?enabled = )false/$1true/s;
   s/allowed_cidrs = \["0\.0\.0\.0\/0"\]/allowed_cidrs = ["127.0.0.1\/32"]/;
   s/allowed_cidrs_v6 = \["::\/0"\]/allowed_cidrs_v6 = ["::1\/128"]/' \
  "$lab_root/supabase/config.toml"

npx supabase \
  --network-id "$network_name" \
  --workdir "$lab_root" \
  start --exclude "$excluded_services" >/dev/null

# Docker Desktop publishes CLI ports on all host interfaces. Keep only
# loopback database clients in the active HBA file; all restore and inventory
# operations run through docker exec and do not require a host TCP connection.
docker exec "$db_container" sed -i.baseline -E \
  '/^host[[:space:]]+all[[:space:]]+all[[:space:]]+(10\.0\.0\.0\/8|172\.16\.0\.0\/12|192\.168\.0\.0\/16|0\.0\.0\.0\/0|::0\/0)/s/^/# baseline-isolation /' \
  /etc/postgresql/pg_hba.conf
docker exec --user postgres "$db_container" pg_ctl reload >/dev/null

if docker exec "$db_container" awk '
  $1 == "host" && $4 != "127.0.0.1/32" && $4 != "::1/128" { found = 1 }
  END { exit found ? 0 : 1 }
' /etc/postgresql/pg_hba.conf; then
  echo "Refusing baseline target with a non-loopback PostgreSQL HBA rule." >&2
  exit 1
fi

running_containers=$(docker ps \
  --filter name=_baseline-local \
  --format '{{.Names}}')
if [ "$running_containers" != "$db_container" ]; then
  echo "Refusing baseline target with unexpected Supabase services running." >&2
  exit 1
fi

npx supabase --network-id "$network_name" --workdir "$lab_root" status -o env > "$status_file"

# Supabase CLI status output is shell-safe assignment syntax.
# shellcheck disable=SC1090
. "$status_file"

baseline_db_url=${DB_URL:-}
case "$baseline_db_url" in
  postgresql://*@127.0.0.1:*|postgres://*@127.0.0.1:*|postgresql://*@localhost:*|postgres://*@localhost:*) ;;
  *)
    echo "Refusing non-local baseline target returned by Supabase status." >&2
    exit 1
    ;;
esac

umask 077
{
  echo "BASELINE_TARGET_KIND=isolated-local-docker"
  echo "BASELINE_TARGET_CONTAINER=$db_container"
  echo "BASELINE_TARGET_DATABASE=postgres"
} > "$repo_root/.env.baseline.local"

echo "Isolated database-only baseline target is running with non-loopback database access denied."
echo "Non-secret local target metadata was written to ignored .env.baseline.local."
