#!/bin/sh
set -eu

previous=barber-staging-frontend-previous
if docker inspect "$previous" >/dev/null 2>&1; then
  docker rm "$previous" >/dev/null
fi
echo "Finalized the accepted staging frontend container."
