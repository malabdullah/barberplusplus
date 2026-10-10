#!/bin/sh
set -eu
test "$(id -u)" = 0
test "$(hostname -s)" = srv1207055
test "$#" = 1
test "$1" = --install-reviewed
test -d /opt/barber-staging-operations
test ! -L /opt/barber-staging-operations
test "$(stat -c %u /opt/barber-staging-operations)" = 0
test "$(stat -c %a /opt/barber-staging-operations)" = 700
test -f /opt/barber-staging-operations/installation-ready.json
# Receipt is written only after supervised capture, off-VPS transfer and restore.
/opt/barber-staging-observer/node --input-type=module -e '
  import assert from "node:assert/strict";
  import { readFileSync, lstatSync } from "node:fs";
  import { liveContext } from "/opt/barber-staging-operations/scripts/staging-live-context.mjs";
  const path = "/opt/barber-staging-operations/installation-ready.json";
  const stat = lstatSync(path);
  assert.ok(stat.uid === 0 && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0);
  const receipt = JSON.parse(readFileSync(path));
  assert.equal(receipt.kind, "reviewed-staging-backup-installation");
  assert.equal(receipt.supervisedCapturePassed, true);
  assert.equal(receipt.offVpsTransferPassed, true);
  assert.equal(receipt.restorePassed, true);
  assert.equal(receipt.failureTestsPassed, true);
  assert.ok(Date.now() - Date.parse(receipt.reviewedAt) >= 0 && Date.now() - Date.parse(receipt.reviewedAt) < 86400000);
  liveContext();
'
install -o root -g root -m 0644 /opt/barber-staging-operations/ops/staging-vps/barber-staging-backup.service /etc/systemd/system/barber-staging-backup.service
install -o root -g root -m 0644 /opt/barber-staging-operations/ops/staging-vps/barber-staging-backup.timer /etc/systemd/system/barber-staging-backup.timer
systemd-analyze verify /etc/systemd/system/barber-staging-backup.service /etc/systemd/system/barber-staging-backup.timer
systemctl daemon-reload
systemctl enable --now barber-staging-backup.timer
systemctl is-enabled barber-staging-backup.timer
systemctl list-timers barber-staging-backup.timer --no-pager
