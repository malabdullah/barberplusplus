#!/bin/sh
set -eu

[ "$(uname -s)" = Linux ] || {
  echo "This audit must run on the staging Linux host." >&2
  exit 1
}

failed=0
check() {
  description=$1
  shift
  if "$@" >/dev/null 2>&1; then
    echo "PASS: $description"
  else
    echo "FAIL: $description" >&2
    failed=1
  fi
}

cpu_count=$(getconf _NPROCESSORS_ONLN)
memory_kib=$(awk '/^MemTotal:/ {print $2}' /proc/meminfo)
disk_kib=$(df -Pk / | awk 'NR == 2 {print $2}')
if [ "$cpu_count" -ge 4 ]; then echo "PASS: at least 4 vCPUs"; else echo "FAIL: fewer than 4 vCPUs" >&2; failed=1; fi
if [ "$memory_kib" -ge 7864320 ]; then echo "PASS: at least 7.5 GiB usable RAM"; else echo "FAIL: less than 7.5 GiB usable RAM" >&2; failed=1; fi
if [ "$disk_kib" -ge 99614720 ]; then echo "PASS: at least 95 GiB usable root disk"; else echo "FAIL: less than 95 GiB usable root disk" >&2; failed=1; fi

check "Docker is installed" command -v docker
check "Docker Compose v2 is installed" docker compose version
check "unattended upgrades are enabled" systemctl is-enabled unattended-upgrades.service
check "UFW is active" sh -c "ufw status | grep -q '^Status: active'"

sshd_effective=$(mktemp)
listeners=$(mktemp)
cleanup() {
  rm -f "$sshd_effective" "$listeners"
}
trap cleanup EXIT INT TERM

if sshd -T > "$sshd_effective" 2>/dev/null; then
  check "root SSH login is disabled" grep -Eq '^permitrootlogin no$' "$sshd_effective"
  check "SSH password authentication is disabled" grep -Eq '^passwordauthentication no$' "$sshd_effective"
else
  echo "FAIL: could not read effective sshd configuration" >&2
  failed=1
fi

ss -lntH > "$listeners"
if awk '$4 ~ /(^|:)(3000|5432|54321|54322|6543|8000)$/ && $4 !~ /^(127\.0\.0\.1|\[::1\]):/ {exit 1}' "$listeners"; then
  echo "PASS: management/database ports are not publicly bound"
else
  echo "FAIL: a management or database port is publicly bound" >&2
  failed=1
fi

exit "$failed"
