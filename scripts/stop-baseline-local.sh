#!/bin/sh
set -eu

repo_root=$(git rev-parse --show-toplevel)
lab_root="$repo_root/.baseline-local"
network_name=barber-baseline-local

if [ ! -f "$lab_root/supabase/config.toml" ]; then
  echo "No isolated baseline target is initialized."
  exit 0
fi

npx supabase --network-id "$network_name" --workdir "$lab_root" stop
