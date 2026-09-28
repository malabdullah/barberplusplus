#!/bin/bash
# Run as root on the staging VPS. Produces a synthetic transport probe only.
# Never captures a database, a live volume, application configuration or secrets.
set -euo pipefail
umask 077
[[ "$(hostname -s)" == srv1207055 && "$EUID" == 0 ]] || { echo 'Staging host/root required.' >&2; exit 1; }
recipient=/etc/barber-staging-backup/recipient.txt
root=/var/backups/barber-staging/export
for path in /etc/barber-staging-backup /var/backups/barber-staging "$root"; do
  [[ -d "$path" && ! -L "$path" && "$(stat -c %u "$path")" == 0 && "$(stat -c %a "$path")" == 700 ]] || exit 1
done
[[ -f "$recipient" && ! -L "$recipient" && "$(stat -c %u "$recipient")" == 0 && "$(stat -c %a "$recipient")" == 600 ]] || exit 1
grep -Eq '^age1[0-9a-z]+$' "$recipient" || exit 1
id="fixture-$(date -u +%Y%m%dT%H%M%SZ)-$(openssl rand -hex 4)"
temporary=$(mktemp -d "$root/.probe-XXXXXXXX")
# Retain failed, private probes for diagnosis; never mark them complete.
mkdir -m 700 "$temporary/source"
printf '%s\n' 'Barber++ synthetic backup transport probe. No application or customer data.' > "$temporary/source/probe.txt"
tar -C "$temporary/source" -cf - probe.txt | age -R "$recipient" -o "$temporary/payload.tar.age"
digest=$(sha256sum "$temporary/payload.tar.age" | cut -d' ' -f1)
bytes=$(stat -c %s "$temporary/payload.tar.age")
created=$(date -u +%Y-%m-%dT%H:%M:%SZ)
printf '{"version":1,"id":"%s","environment":"staging","sourceHost":"srv1207055","kind":"synthetic-probe","file":"payload.tar.age","sha256":"%s","bytes":%s,"createdAt":"%s"}\n' "$id" "$digest" "$bytes" "$created" > "$temporary/manifest.json"
# Delete only this invocation's known, synthetic plaintext file and empty dir.
rm "$temporary/source/probe.txt"
rmdir "$temporary/source"
chmod 600 "$temporary/payload.tar.age" "$temporary/manifest.json"
destination="$root/$id"
mkdir -m 700 "$destination"
mv "$temporary/payload.tar.age" "$destination/payload.tar.age"
mv "$temporary/manifest.json" "$destination/manifest.json"
rmdir "$temporary"
printf '%s\n' "$id"
