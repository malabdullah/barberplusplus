#!/bin/sh
set -eu

: "${DEPLOY_SHA:?DEPLOY_SHA is required}"
: "${STAGING_FUNCTION_ENV_FILE:?STAGING_FUNCTION_ENV_FILE is required}"
: "${STAGING_FUNCTION_STATE_DIR:?STAGING_FUNCTION_STATE_DIR is required}"

runner_root=/Users/malabdullah/actions-runner-barber-staging
case "$DEPLOY_SHA" in *[!0-9a-f]*|'') echo 'DEPLOY_SHA must be a lowercase commit SHA.' >&2; exit 1 ;; esac
[ "${#DEPLOY_SHA}" -eq 40 ] || { echo 'DEPLOY_SHA must contain 40 characters.' >&2; exit 1; }
case "$STAGING_FUNCTION_ENV_FILE" in "$runner_root"/.secrets/*) ;; *) echo 'Refusing to read function secrets outside the protected staging runner directory.' >&2; exit 1 ;; esac
case "$STAGING_FUNCTION_STATE_DIR" in "$runner_root"/_state/*) ;; *) echo 'Refusing to write function state outside the staging runner directory.' >&2; exit 1 ;; esac
[ -f "$STAGING_FUNCTION_ENV_FILE" ] || { echo 'Staging function environment file is absent.' >&2; exit 1; }

workspace=$(pwd -P)
case "$workspace" in "$runner_root"/_work/barberplusplus/barberplusplus/release-source) ;; *) echo 'Edge Functions must be deployed from the dedicated staging release checkout.' >&2; exit 1 ;; esac

cli_version=$(node -p "require('./node_modules/supabase/package.json').version")
source_binary="$workspace/node_modules/@supabase/cli-darwin-arm64/bin/supabase"
tools_dir="$runner_root/_tools"
supabase_binary="$tools_dir/supabase-$cli_version"
releases_dir="$runner_root/_releases/functions"
release_root="$releases_dir/$DEPLOY_SHA"

[ -x "$source_binary" ] || { echo 'The pinned Supabase CLI platform binary is not installed.' >&2; exit 1; }
umask 077
mkdir -p "$STAGING_FUNCTION_STATE_DIR" "$tools_dir" "$releases_dir"

if [ -e "$STAGING_FUNCTION_STATE_DIR/previous.plist" ] || [ -e "$STAGING_FUNCTION_STATE_DIR/no-previous" ]; then
  echo 'A prior Edge Function deployment has not been finalized or rolled back.' >&2
  exit 1
fi

if [ -e "$supabase_binary" ]; then
  cmp -s "$source_binary" "$supabase_binary" || { echo 'Pinned Supabase CLI cache does not match the installed package.' >&2; exit 1; }
else
  binary_temp="$tools_dir/.supabase-$cli_version-$$"
  cp "$source_binary" "$binary_temp"
  chmod 700 "$binary_temp"
  mv "$binary_temp" "$supabase_binary"
fi
"$supabase_binary" --version | grep -Fx "$cli_version" >/dev/null

release_temp="$releases_dir/.$DEPLOY_SHA-$$"
mkdir -p "$release_temp/supabase"
cp "$workspace/supabase/config.toml" "$release_temp/supabase/config.toml"
rsync -a --exclude '.env*' "$workspace/supabase/functions/" "$release_temp/supabase/functions/"
if [ -d "$release_root" ]; then
  if ! diff -qr "$release_temp" "$release_root" >/dev/null; then
    rm -rf "$release_temp"
    echo 'Existing immutable function release does not match this commit.' >&2
    exit 1
  fi
  rm -rf "$release_temp"
else
  mv "$release_temp" "$release_root"
fi

label=cloud.malabdullah.barber-staging-functions
service_domain="gui/$(id -u)"
plist=/Users/malabdullah/Library/LaunchAgents/$label.plist
plist_temp="$STAGING_FUNCTION_STATE_DIR/$label.plist"
previous_plist="$STAGING_FUNCTION_STATE_DIR/previous.plist"
no_previous="$STAGING_FUNCTION_STATE_DIR/no-previous"
log_file="$STAGING_FUNCTION_STATE_DIR/serve.log"
error_log="$STAGING_FUNCTION_STATE_DIR/serve-error.log"
runner_path=$(tr -d '\n' < "$runner_root/.path")

if [ -f "$plist" ]; then cp "$plist" "$previous_plist"; else : > "$no_previous"; fi

plutil -create xml1 "$plist_temp"
plutil -insert Label -string "$label" "$plist_temp"
plutil -insert ProgramArguments -json "$(jq -cn --arg binary "$supabase_binary" --arg root "$release_root" --arg envFile "$STAGING_FUNCTION_ENV_FILE" '[$binary, "functions", "serve", "--workdir", $root, "--env-file", $envFile]')" "$plist_temp"
plutil -insert WorkingDirectory -string "$release_root" "$plist_temp"
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
if ! launchctl bootstrap "$service_domain" "$plist" || ! launchctl kickstart -k "$service_domain/$label"; then
  sh scripts/rollback-local-staging-functions.sh
  exit 1
fi

if sh scripts/check-local-staging-functions.sh; then
  launchctl print "$service_domain/$label" >/dev/null
  echo "Staging Edge Functions are healthy from immutable release $DEPLOY_SHA."
  exit 0
fi

sh scripts/rollback-local-staging-functions.sh
echo "Staging Edge Functions failed readiness and were rolled back; inspect $log_file and $error_log." >&2
exit 1
