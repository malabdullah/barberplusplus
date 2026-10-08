#!/bin/sh
# First install only, from a separately hash-verified root-owned frozen bundle.
set -eu
test "$#" -eq 0
test "$(id -u)" = 0
test "$(hostname)" = srv1207055
test "$(uname -m)" = x86_64
test "$(id -u barber-staging-deploy)" = 997
test "$(id -g barber-staging-deploy)" = 985
test "$(id -G barber-staging-deploy)" = 985
test "$(getent passwd barber-staging-deploy | cut -d: -f7)" = /usr/sbin/nologin
bundle=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
case "$bundle" in /root/barber-staging-observer-install.*) ;; *) exit 1 ;; esac
test "$(stat -c '%u:%g:%a' "$bundle")" = 0:0:700
files='runner.mjs selection.json barber-staging-observer.service staging-observer.mjs staging-evidence-transport.mjs staging-release-envelope.mjs staging-approval-evidence.mjs staging-attestation-verifier.mjs staging-vps-verifier.mjs install.sh'
for file in $files; do
  test ! -L "$bundle/$file"
  test -f "$bundle/$file"
  test "$(stat -c '%u:%g:%a:%h' "$bundle/$file")" = 0:0:444:1
done
for path in /opt /etc /etc/systemd /etc/systemd/system; do
  test ! -L "$path"
  test "$(stat -c '%u:%g:%a' "$path")" = 0:0:755
done
for path in /opt/barber-staging-observer /etc/barber-staging-observer /var/lib/barber-staging-observer /run/barber-staging-observer /etc/systemd/system/barber-staging-observer.service /etc/systemd/system/barber-staging-observer.service.d; do
  test ! -e "$path" && test ! -L "$path"
done
test "$(systemctl show barber-staging-observer.service -p LoadState --value)" = not-found
test ! -L /etc/credstore.encrypted/barber-staging-github-app-key.cred
test "$(stat -c '%u:%g:%a:%h' /etc/credstore.encrypted/barber-staging-github-app-key.cred)" = 0:0:600:1
test "$(sha256sum /opt/barber-staging/supabase/tools/node | cut -d' ' -f1)" = 89af8424dd53e560b1933f87ba650d8bf57c83ca5a04600eefb31f416aabbae7
test "$(sha256sum /usr/local/bin/gh | cut -d' ' -f1)" = 7469124f706944133d6a169691dd1c6c3511b12e85878d255e044e2948df4c9b
install -d -o root -g root -m 0755 /opt/barber-staging-observer /opt/barber-staging-observer/scripts /etc/barber-staging-observer
install -o root -g root -m 0755 /opt/barber-staging/supabase/tools/node /opt/barber-staging-observer/node
install -o root -g root -m 0644 "$bundle/runner.mjs" /opt/barber-staging-observer/runner.mjs
for file in staging-observer.mjs staging-evidence-transport.mjs staging-release-envelope.mjs staging-approval-evidence.mjs staging-attestation-verifier.mjs staging-vps-verifier.mjs; do
  install -o root -g root -m 0644 "$bundle/$file" "/opt/barber-staging-observer/scripts/$file"
done
install -o root -g root -m 0644 "$bundle/selection.json" /etc/barber-staging-observer/selection.json
install -o root -g root -m 0644 "$bundle/barber-staging-observer.service" /etc/systemd/system/barber-staging-observer.service
systemd-analyze verify /etc/systemd/system/barber-staging-observer.service
systemctl daemon-reload
test "$(systemctl is-enabled barber-staging-observer.service)" = static
test "$(systemctl show barber-staging-observer.service -p ActiveState --value)" = inactive
printf '%s\n' 'Manual observer installed, inactive and unscheduled. No deployment capability.'
