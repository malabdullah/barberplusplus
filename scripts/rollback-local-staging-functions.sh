#!/bin/sh
set -eu

: "${STAGING_FUNCTION_STATE_DIR:?STAGING_FUNCTION_STATE_DIR is required}"

runner_root=/Users/malabdullah/actions-runner-barber-staging
case "$STAGING_FUNCTION_STATE_DIR" in
  "$runner_root"/_state/*) ;;
  *) echo "Refusing to read function state outside the staging runner directory." >&2; exit 1 ;;
esac

label=cloud.malabdullah.barber-staging-functions
service_domain="gui/$(id -u)"
plist=/Users/malabdullah/Library/LaunchAgents/$label.plist
previous_plist="$STAGING_FUNCTION_STATE_DIR/previous.plist"
no_previous="$STAGING_FUNCTION_STATE_DIR/no-previous"

if [ ! -f "$previous_plist" ] && [ ! -f "$no_previous" ]; then
  echo 'No pending staging Edge Function deployment to roll back.'
  exit 0
fi

launchctl bootout "$service_domain/$label" >/dev/null 2>&1 || true

if [ -f "$previous_plist" ]; then
  cp "$previous_plist" "$plist"
  chmod 600 "$plist"
  launchctl bootstrap "$service_domain" "$plist"
  launchctl kickstart -k "$service_domain/$label"
  sh scripts/check-local-staging-functions.sh
  echo 'Restored the previous staging Edge Function release.'
elif [ -f "$no_previous" ]; then
  rm -f "$plist"
  echo 'Removed the first staging Edge Function release because no prior release existed.'
fi

rm -f "$previous_plist" "$no_previous"
