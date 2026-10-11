#!/bin/sh
set -eu

command -v rg >/dev/null 2>&1 || {
  echo "Domain scan unavailable: ripgrep is required." >&2
  exit 1
}

forbidden_pattern='supabase\.malabdullah\.cloud|barber\.malabdullah\.cloud|pqaidfykknoiqmosfvnb\.supabase\.co'

if rg -n "$forbidden_pattern" \
  src public index.html docker .env.example .env.local.example \
  --glob '!**/*-preview.html'; then
  echo "Environment-neutral application files contain a production domain." >&2
  exit 1
else
  scan_status=$?
  if [ "$scan_status" -ne 1 ]; then
    echo "Domain scan failed; no clean result claimed." >&2
    exit "$scan_status"
  fi
fi

echo "No hardcoded production domains found in environment-neutral application files."
