#!/bin/bash
set -euo pipefail
# Never trace or print environment values. This single-node self-hosted profile
# intentionally has no AWS credential, discovery, certificate or crash export.
fail() { echo 'Realtime staging security profile rejected configuration' >&2; exit 78; }
for name in $(compgen -A variable AWS_); do
  [[ -z "${!name}" ]] || fail
done
for name in GENERATE_CLUSTER_CERTS CLUSTER_SECRET_ID CLUSTER_SECRET_REGION \
  ECS_CONTAINER_METADATA_URI ECS_CONTAINER_METADATA_URI_V4 \
  ERL_CRASH_DUMP_S3_BUCKET ERL_CRASH_DUMP_S3_HOST ERL_CRASH_DUMP_S3_PORT \
  ERL_CRASH_DUMP_S3_KEY ERL_CRASH_DUMP_S3_SECRET; do
  [[ -z "${!name:-}" ]] || fail
done
[[ "${ENABLE_ERL_CRASH_DUMP:-false}" == false ]] || fail
[[ "$(id -u)" == 65534 && "$(id -g)" == 65534 ]] || fail
awk '
  /^Cap(Eff|Prm|Bnd):/ { if ($2 != "0000000000000000") bad=1; caps++ }
  /^NoNewPrivs:/ { if ($2 != "1") bad=1; nnp++ }
  END { exit bad || caps != 3 || nnp != 1 }
' /proc/self/status || fail
awk '$5 == "/" { roots++; if ($6 !~ /(^|,)ro(,|$)/) bad=1 }
  END { exit bad || roots != 1 }' /proc/self/mountinfo || fail
export ENABLE_ERL_CRASH_DUMP=false
if [[ "$#" == 1 && "$1" == --check-profile ]]; then exit 0; fi
exec /app/run.sh "$@"
