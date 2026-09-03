#!/bin/sh
set -eu

current=barber-staging-frontend
previous=barber-staging-frontend-previous

if ! docker inspect "$previous" >/dev/null 2>&1; then
  echo "No retained staging frontend container is available for rollback."
  exit 0
fi

docker rm -f "$current" >/dev/null 2>&1 || true
docker rename "$previous" "$current"
docker start "$current" >/dev/null
echo "Restored the previous staging frontend container."
