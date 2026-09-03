#!/bin/sh
set -eu

required_variables="APP_ENV APP_URL SUPABASE_PUBLIC_URL SUPABASE_PUBLISHABLE_KEY"
for variable_name in $required_variables; do
  eval "variable_value=\${$variable_name:-}"
  if [ -z "$variable_value" ]; then
    echo "Missing required runtime variable: $variable_name" >&2
    exit 1
  fi
done

case "$APP_ENV" in
  staging|production) ;;
  *)
    echo "APP_ENV must be staging or production in the container." >&2
    exit 1
    ;;
esac

case "$APP_URL $SUPABASE_PUBLIC_URL $SUPABASE_PUBLISHABLE_KEY" in
  *\'*|*\"*|*\`*|*\\*)
    echo "Runtime values contain unsupported characters." >&2
    exit 1
    ;;
esac

case "$APP_URL" in
  https://*) ;;
  *) echo "APP_URL must use HTTPS." >&2; exit 1 ;;
esac

validate_origin() {
  label=$1
  value=$2
  authority=${value#https://}
  case "$authority" in
    ''|*@*|*/*|*\?*|*\#*)
      echo "$label must be an HTTPS origin without credentials, path, query, or fragment." >&2
      exit 1
      ;;
  esac
}

validate_origin APP_URL "$APP_URL"
validate_origin SUPABASE_PUBLIC_URL "$SUPABASE_PUBLIC_URL"

case "$SUPABASE_PUBLIC_URL" in
  https://*) ;;
  *) echo "SUPABASE_PUBLIC_URL must use HTTPS." >&2; exit 1 ;;
esac

case "$SUPABASE_PUBLISHABLE_KEY" in
  sb_publishable_*) ;;
  eyJ*.*.*)
    encoded_payload=$(printf '%s' "$SUPABASE_PUBLISHABLE_KEY" | cut -d. -f2 | tr '_-' '/+')
    remainder=$((${#encoded_payload} % 4))
    if [ "$remainder" -eq 2 ]; then encoded_payload="${encoded_payload}=="; fi
    if [ "$remainder" -eq 3 ]; then encoded_payload="${encoded_payload}="; fi
    decoded_payload=$(printf '%s' "$encoded_payload" | base64 -d 2>/dev/null || true)
    printf '%s' "$decoded_payload" | grep -Eq '"role"[[:space:]]*:[[:space:]]*"anon"' || {
      echo "Legacy JWT must contain the anon role." >&2
      exit 1
    }
    ;;
  *) echo "SUPABASE_PUBLISHABLE_KEY must be browser-safe." >&2; exit 1 ;;
esac

SUPABASE_REALTIME_URL="${SUPABASE_REALTIME_URL:-$(printf '%s' "$SUPABASE_PUBLIC_URL" | sed 's#^https:#wss:#')}"
APP_RELEASE="${APP_RELEASE:-unknown}"

case "$SUPABASE_REALTIME_URL" in
  wss://*) ;;
  *) echo "SUPABASE_REALTIME_URL must use WSS." >&2; exit 1 ;;
esac
realtime_authority=${SUPABASE_REALTIME_URL#wss://}
case "$realtime_authority" in
  ''|*@*|*/*|*\?*|*\#*|*\'*|*\"*|*\`*|*\\*)
    echo "SUPABASE_REALTIME_URL must be a WSS origin without credentials, path, query, or fragment." >&2
    exit 1
    ;;
esac

case "$APP_RELEASE" in
  *[!A-Za-z0-9._-]*) echo "APP_RELEASE contains unsupported characters." >&2; exit 1 ;;
esac
if [ "$APP_ENV" = staging ]; then
  ROBOTS_HEADER='noindex, nofollow'
else
  ROBOTS_HEADER='index, follow'
fi
export SUPABASE_REALTIME_URL APP_RELEASE ROBOTS_HEADER

envsubst '${APP_ENV} ${APP_URL} ${SUPABASE_PUBLIC_URL} ${SUPABASE_PUBLISHABLE_KEY} ${APP_RELEASE}' \
  < /opt/barber/runtime-config.js.template \
  > /usr/share/nginx/html/runtime-config.js

envsubst '${SUPABASE_PUBLIC_URL} ${SUPABASE_REALTIME_URL} ${ROBOTS_HEADER}' \
  < /opt/barber/nginx.conf.template \
  > /etc/nginx/conf.d/default.conf
