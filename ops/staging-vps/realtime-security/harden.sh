#!/bin/sh
set -eu
export LC_ALL=C
# Fail closed if the pinned base ever contains extra package sources.
test ! -s /etc/apt/sources.list
test "$(find /etc/apt/sources.list.d -type f | wc -l)" -eq 1
mkdir -p /usr/local/share/barber-realtime-evidence
evidence=/usr/local/share/barber-realtime-evidence
find /app -type f -exec sha256sum '{}' + | sort > "$evidence/app.sha256"
dpkg-query -W -f='${binary:Package}\t${Version}\n' > "$evidence/packages-before.tsv"
apt-get -o APT::Update::Error-Mode=any update
sha256sum -c /tmp/realtime-snapshot.sha256
cp /tmp/realtime-snapshot.sha256 "$evidence/snapshot.sha256"
DEBIAN_FRONTEND=noninteractive apt-get upgrade -y --no-install-recommends
apt-get -s autoremove --purge awscli sudo > "$evidence/removal-plan.txt"
awk '/^(Remv|Purg) / {print $2}' "$evidence/removal-plan.txt" > "$evidence/removed-packages.txt"
test -s "$evidence/removed-packages.txt"
while IFS= read -r package; do
  flags=$(dpkg-query -W -f='${Essential} ${Protected}' "$package")
  case "$flags" in *yes*) echo 'Refusing Essential/Protected package removal' >&2; exit 1;; esac
done < "$evidence/removed-packages.txt"
# Debian's sudo pre-removal check assumes a login host; this disposable image
# has no administrator login and intentionally no privilege escalation tool.
SUDO_FORCE_REMOVE=yes DEBIAN_FRONTEND=noninteractive apt-get autoremove --purge -y awscli sudo
for tool in aws sudo python3; do
  if command -v "$tool" >/dev/null 2>&1; then echo 'Optional tool unexpectedly retained' >&2; exit 1; fi
done
sha256sum -c "$evidence/app.sha256" >/dev/null
dpkg-query -W -f='${binary:Package}\t${Version}\n' > "$evidence/packages-after.tsv"
# Keep Debian Essential files; only remove privilege-elevation mode bits.
find / -xdev -type f -perm /6000 -exec chmod a-s '{}' +
chown -R 0:0 /app
chmod -R go-w /app
chown 65534:65534 /app/.pgdelta-cache
apt-get clean
rm -rf /var/lib/apt/lists/*
