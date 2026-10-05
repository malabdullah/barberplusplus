#!/usr/bin/env bash
# Disposable native staging check. No ports, volumes, egress or live credentials.
set -euo pipefail
umask 077
test "$(hostname)" = srv1207055
test "$(uname -m)" = x86_64
image=sha256:78f25384ba6173d08f4dd7969989f5115d986cf4e8923f7906bf4fa00bfd1902
test "$(docker image inspect --platform linux/amd64 --format '{{.Id}}' "$image")" = "$image"
test "$(docker image inspect --platform linux/amd64 --format '{{.Config.User}}' "$image")" = '65534:65534'
test "$(docker image inspect --platform linux/amd64 --format '{{index .Config.Labels "cloud.malabdullah.barber.candidate"}}' "$image")" = realtime-security-local-only
probe_dir=$(mktemp -d /tmp/barber-realtime-native.XXXXXXXX)
probe_id=${probe_dir##*/}
container="${probe_id}-check"
cleanup() {
  local found
  found=$(docker ps -aq --filter "name=^/${container}$" --filter "label=barber.realtime.native=$probe_id")
  if [ -n "$found" ]; then docker rm -f "$container" >/dev/null; fi
}
trap cleanup EXIT
profile=(--rm --name "$container" --label "barber.realtime.native=$probe_id"
  --platform linux/amd64 --network none --read-only --cap-drop ALL
  --security-opt no-new-privileges --memory 1g --cpus 1 --pids-limit 256
  --tmpfs /tmp:rw,nosuid,nodev,noexec,size=64m,mode=1777
  --tmpfs /app/.pgdelta-cache:rw,nosuid,nodev,exec,size=256m,uid=65534,gid=65534,mode=0700)
docker run "${profile[@]}" "$image" --check-profile >"$probe_dir/profile.txt" 2>&1
for setting in AWS_EXECUTION_ENV AWS_ACCESS_KEY_ID GENERATE_CLUSTER_CERTS CLUSTER_SECRET_ID ECS_CONTAINER_METADATA_URI_V4 ENABLE_ERL_CRASH_DUMP ERL_CRASH_DUMP_S3_SECRET; do
  result=0
  docker run "${profile[@]}" --env "$setting=synthetic-blocked-value" "$image" --check-profile >"$probe_dir/denial.txt" 2>&1 || result=$?
  test "$result" = 78
  grep -q 'Realtime staging security profile rejected configuration' "$probe_dir/denial.txt"
  if grep -q 'synthetic-blocked-value' "$probe_dir/denial.txt"; then exit 1; fi
done
for unsafe in root writable-root extra-capability no-nnp; do
  altered=()
  for argument in "${profile[@]}"; do
    case "$unsafe:$argument" in
      writable-root:--read-only|no-nnp:--security-opt|no-nnp:no-new-privileges) continue ;;
    esac
    altered+=("$argument")
  done
  case "$unsafe" in
    root) altered+=(--user 0:0) ;;
    extra-capability) altered+=(--cap-add SYS_ADMIN) ;;
  esac
  result=0
  docker run "${altered[@]}" "$image" --check-profile >"$probe_dir/denial.txt" 2>&1 || result=$?
  test "$result" = 78
  grep -q 'Realtime staging security profile rejected configuration' "$probe_dir/denial.txt"
done
docker run "${profile[@]}" --entrypoint /bin/sh "$image" -ec '
  test "$(id -u)" = 65534
  test ! -w /app/run.sh
  test "$(stat -c %u /app/run.sh)" = 0
  sha256sum -c /usr/local/share/barber-realtime-evidence/app.sha256 >/dev/null
  test -z "$(find /usr /bin /sbin -xdev -type f -perm /6000 -print)"
  for tool in aws sudo python3; do if command -v "$tool" >/dev/null; then exit 1; fi; done
  test ! -e /usr/lib/systemd/systemd-homed
  perl -e "exit 0"
  if perl -MArchive::Tar -e 1 2>/dev/null; then exit 1; fi
  test -z "$(grep -Ev "^(#|[[:space:]]*$)" /etc/fstab)"
  pgdelta --help >/dev/null
  /app/erts-16.4.0.4/bin/erl -version
' >"$probe_dir/native.txt" 2>&1
# Fresh synthetic-only keys. No ARM emulation workaround is allowed here.
RELEASE_COOKIE=$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n')
METRICS_JWT_SECRET=$(openssl rand -hex 32)
SECRET_KEY_BASE=$(openssl rand -hex 32)
API_JWT_SECRET=$(openssl rand -hex 32)
export RELEASE_COOKIE METRICS_JWT_SECRET SECRET_KEY_BASE API_JWT_SECRET
docker run "${profile[@]}" --env RELEASE_COOKIE --env METRICS_JWT_SECRET --env SECRET_KEY_BASE --env API_JWT_SECRET \
  --env DB_HOST=127.0.0.1 --env DB_IP_VERSION=ipv4 --env APP_NAME=realtime \
  --env 'ERL_AFLAGS=+S 2:2 -proto_dist inet_tcp' --entrypoint /app/bin/realtime \
  "$image" eval 'IO.puts("RELEASE_EVAL_PASS")' >"$probe_dir/release.txt" 2>&1
unset RELEASE_COOKIE METRICS_JWT_SECRET SECRET_KEY_BASE API_JWT_SECRET
grep -q RELEASE_EVAL_PASS "$probe_dir/release.txt"
printf 'NATIVE_PROFILE_PASS image=%s host=srv1207055 emulation=false deployment_authorized=false evidence=%s\n' "$image" "$probe_dir"
