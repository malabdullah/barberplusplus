#!/bin/bash
# Run locally in an interactive terminal. Never paste the key into a command.
set +x
set +a
set -euo pipefail
ulimit -c 0

if [ "$#" -ne 1 ] || [ ! -t 0 ]; then
  printf '%s\n' 'Usage (interactive terminal only): bash scripts/test-staging-recovery-key.sh <fixture-id>' >&2
  exit 1
fi
backup_script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
node "$backup_script_dir/verify-staging-recovery-key.mjs" --preflight "$1"
printf '%s\n' 'Copy the key from Apple Passwords, not from the local identity file.'
printf '%s' 'Paste recovery key (hidden), then press Return: '
unset backup_recovery_key
backup_recovery_key=''
trap 'unset backup_recovery_key' EXIT
trap 'printf "\nRecovery check cancelled.\n"; exit 130' INT TERM
if ! IFS= read -r -s backup_recovery_key; then
  printf '\n%s\n' 'Recovery check cancelled.' >&2
  exit 1
fi
printf '\n'
printf '%s\n' "$backup_recovery_key" | node "$backup_script_dir/verify-staging-recovery-key.mjs" --verify "$1"
unset backup_recovery_key
