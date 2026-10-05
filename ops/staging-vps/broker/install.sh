#!/bin/sh
# First installation only. Refuse existing destinations; upgrades are reviewed separately.
set -eu
PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH
[ "$(id -u)" = 0 ] || { echo 'Run as the staging administrator with sudo.' >&2; exit 1; }
[ "$(hostname)" = srv1207055 ] && [ "$(uname -m)" = x86_64 ] || { echo 'Wrong host.' >&2; exit 1; }
[ "$#" = 0 ] || { echo 'No arguments accepted.' >&2; exit 1; }
source_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
# Only a separately frozen, hash-verified root-owned payload is executable.
# This check is inline so it cannot import mutable source before verifying it.
/usr/bin/python3 -I -B - "$source_dir" <<'PY'
from pathlib import Path
import stat
import sys

source = Path(sys.argv[1])
if source.parent != Path('/root') or not source.name.startswith('barber-staging-broker-install.'):
    raise SystemExit('Use a new protected /root/barber-staging-broker-install.* directory.')
files = ('install.sh', 'broker.py', 'test_broker.py', 'verify_install.py',
         'barber-staging-broker.socket', 'barber-staging-broker.service')
for path in (source, *source.parents, *(source / name for name in files)):
    info = path.lstat()
    if info.st_uid != 0 or info.st_mode & 0o022 or stat.S_ISLNK(info.st_mode):
        raise SystemExit('Installation payload or ancestor is not protected.')
    expected = stat.S_ISDIR if path in (source, *source.parents) else stat.S_ISREG
    if not expected(info.st_mode):
        raise SystemExit('Unexpected installation payload type.')
for target in ('/usr/local/libexec/barber-staging-broker', '/etc/systemd/system/barber-staging-broker.service',
               '/var/lib/barber-staging-deploy', '/run/barber-staging-broker.sock'):
    for ancestor in Path(target).parents:
        try:
            info = ancestor.lstat()
        except FileNotFoundError:
            continue
        if info.st_uid != 0 or info.st_mode & 0o022 or not stat.S_ISDIR(info.st_mode):
            raise SystemExit('Installation destination ancestor is not protected.')
PY
destination=/usr/local/libexec/barber-staging-broker
for target in "$destination" /etc/systemd/system/barber-staging-broker.socket /etc/systemd/system/barber-staging-broker.service /var/lib/barber-staging-deploy /run/barber-staging-broker.sock; do
  if [ -e "$target" ] || [ -L "$target" ]; then echo 'Existing installation requires explicit upgrade review.' >&2; exit 1; fi
done
for user in barber-staging-broker barber-staging-deploy; do
  if getent passwd "$user" >/dev/null; then echo 'Existing account requires identity review.' >&2; exit 1; fi
  if getent group "$user" >/dev/null; then echo 'Existing group requires identity review.' >&2; exit 1; fi
done
if getent group barber-staging-release >/dev/null; then echo 'Existing socket group requires review.' >&2; exit 1; fi
/usr/bin/python3 -I -B "$source_dir/verify_install.py" preflight
# Tests are run before any persistent account/service changes.
/usr/bin/python3 -I -B "$source_dir/test_broker.py"
groupadd --system barber-staging-release
useradd --system --user-group --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin barber-staging-broker
useradd --system --user-group --create-home --home-dir /var/lib/barber-staging-deploy --shell /usr/sbin/nologin barber-staging-deploy
chmod 0700 /var/lib/barber-staging-deploy
# Neither identity is put in Docker, sudo, or the socket group. Root may inspect
# the read-only socket. Future verifier/broker access requires a separate review.
install -d -o root -g root -m 0755 "$destination"
install -o root -g root -m 0644 "$source_dir/broker.py" "$destination/broker.py"
install -o root -g root -m 0644 "$source_dir/barber-staging-broker.socket" /etc/systemd/system/barber-staging-broker.socket
install -o root -g root -m 0644 "$source_dir/barber-staging-broker.service" /etc/systemd/system/barber-staging-broker.service
systemd-analyze verify /etc/systemd/system/barber-staging-broker.socket /etc/systemd/system/barber-staging-broker.service
systemctl daemon-reload
/usr/bin/python3 -I -B "$source_dir/verify_install.py" effective
systemctl enable --now barber-staging-broker.socket
echo 'Installed read-only foundation. Deployment and automation remain disabled.'
