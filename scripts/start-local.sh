#!/bin/sh
set -eu

if [ ! -f .env.local ]; then
  echo "Missing .env.local. Run npm run local:bootstrap first." >&2
  exit 1
fi

npx supabase start >/dev/null
npx supabase functions serve --env-file supabase/functions/.env.local &
functions_pid=$!

cleanup() {
  kill "$functions_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

npm run dev -- --host 127.0.0.1

