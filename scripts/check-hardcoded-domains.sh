#!/bin/sh
set -eu

forbidden_pattern='supabase\.malabdullah\.cloud|barber\.malabdullah\.cloud|pqaidfykknoiqmosfvnb\.supabase\.co'

if rg -n "$forbidden_pattern" \
  src public index.html docker .env.example .env.local.example \
  --glob '!**/*-preview.html'; then
  echo "Environment-neutral application files contain a production domain." >&2
  exit 1
fi

echo "No hardcoded production domains found in environment-neutral application files."

