#!/bin/sh
set -eu

: "${STAGING_FUNCTION_ENV_FILE:?STAGING_FUNCTION_ENV_FILE is required}"
: "${STAGING_FUNCTION_STATE_DIR:?STAGING_FUNCTION_STATE_DIR is required}"

case "$STAGING_FUNCTION_ENV_FILE" in
  /Users/malabdullah/actions-runner-barber-staging/.secrets/*) ;;
  *) echo "Refusing to read function secrets outside the protected staging runner directory." >&2; exit 1 ;;
esac
case "$STAGING_FUNCTION_STATE_DIR" in
  /Users/malabdullah/actions-runner-barber-staging/_state/*) ;;
  *) echo "Refusing to write function state outside the staging runner directory." >&2; exit 1 ;;
esac
[ -f "$STAGING_FUNCTION_ENV_FILE" ] || { echo "Staging function environment file is absent." >&2; exit 1; }

umask 077
mkdir -p "$STAGING_FUNCTION_STATE_DIR"
log_file="$STAGING_FUNCTION_STATE_DIR/serve.log"
error_log="$STAGING_FUNCTION_STATE_DIR/serve-error.log"
workspace=$(pwd -P)
case "$workspace" in
  /Users/malabdullah/actions-runner-barber-staging/_work/barberplusplus/barberplusplus) ;;
  *) echo "Edge Functions must be deployed from the dedicated staging runner checkout." >&2; exit 1 ;;
esac

supabase_binary="$workspace/node_modules/.bin/supabase"
[ -x "$supabase_binary" ] || { echo "The pinned Supabase CLI is not installed." >&2; exit 1; }

label=cloud.malabdullah.barber-staging-functions
service_domain="gui/$(id -u)"
plist=/Users/malabdullah/Library/LaunchAgents/$label.plist
plist_temp="$STAGING_FUNCTION_STATE_DIR/$label.plist"
runner_path=$(tr -d '\n' < /Users/malabdullah/actions-runner-barber-staging/.path)

plutil -create xml1 "$plist_temp"
plutil -insert Label -string "$label" "$plist_temp"
plutil -insert ProgramArguments -json "$(jq -cn \
  --arg binary "$supabase_binary" \
  --arg envFile "$STAGING_FUNCTION_ENV_FILE" \
  '[$binary, "functions", "serve", "--env-file", $envFile]')" "$plist_temp"
plutil -insert WorkingDirectory -string "$workspace" "$plist_temp"
plutil -insert RunAtLoad -bool true "$plist_temp"
plutil -insert KeepAlive -bool true "$plist_temp"
plutil -insert ProcessType -string Background "$plist_temp"
plutil -insert StandardOutPath -string "$log_file" "$plist_temp"
plutil -insert StandardErrorPath -string "$error_log" "$plist_temp"
plutil -insert EnvironmentVariables -json "$(jq -cn --arg path "$runner_path" '{PATH: $path}')" "$plist_temp"
chmod 600 "$plist_temp"

launchctl bootout "$service_domain/$label" >/dev/null 2>&1 || true
mv "$plist_temp" "$plist"
chmod 600 "$plist"
launchctl bootstrap "$service_domain" "$plist"
launchctl kickstart -k "$service_domain/$label"

attempt=0
while [ "$attempt" -lt 60 ]; do
  status=$(curl --silent --output /dev/null --write-out '%{http_code}' \
    http://127.0.0.1:54321/functions/v1/get-kuwait-governorates || true)
  if [ "$status" != 000 ]; then
    launchctl print "$service_domain/$label" >/dev/null
    echo "Staging Edge Functions are responding locally under their persistent service."
    exit 0
  fi
  sleep 1
  attempt=$((attempt + 1))
done

echo "Staging Edge Functions did not become ready; inspect $log_file and $error_log." >&2
exit 1
