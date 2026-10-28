#!/bin/sh
set -eu
umask 077
base=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
python3 "$base/runtime/check-root.py"
export SUPABASE_HOME=/workspace/barber-cloud-candidate-state/tool-install-home
export DO_NOT_TRACK=1 SUPABASE_TELEMETRY_DISABLED=1
npm ci --prefix "$base/tooling/node" --no-audit --no-fund
export PATH="$base/tooling/node/node_modules/.bin:$PATH"
[ "$(node --version)" = v24.20.0 ]
npm ci --prefix "$base/tooling/native" --no-audit --no-fund
[ "$("$base/tooling/native/node_modules/.bin/supabase" --version)" = 3.0.0-next.25 ]
cd "$base/../.."
npm ci --no-audit --no-fund
# Optional preview dependencies only: no CLI login or tunnel creation.
npm ci --prefix "$base/preview/sdk-scratch" --ignore-scripts --no-audit --no-fund
