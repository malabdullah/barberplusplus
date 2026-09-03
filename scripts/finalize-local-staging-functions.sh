#!/bin/sh
set -eu

: "${STAGING_FUNCTION_STATE_DIR:?STAGING_FUNCTION_STATE_DIR is required}"

case "$STAGING_FUNCTION_STATE_DIR" in
  /Users/malabdullah/actions-runner-barber-staging/_state/*) ;;
  *) echo "Refusing to finalize function state outside the staging runner directory." >&2; exit 1 ;;
esac

rm -f "$STAGING_FUNCTION_STATE_DIR/previous.plist" "$STAGING_FUNCTION_STATE_DIR/no-previous"
echo 'Finalized the accepted staging Edge Function release.'
