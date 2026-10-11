#!/bin/sh
set -eu
umask 077
[ "$(hostname)" = srv1207055 ]
[ "$(id -u)" = 0 ]
[ "$#" = 0 ]
source_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
target=/opt/barber-staging-test-operations
test ! -e "$target"
test ! -L "$target"
test -x /opt/barber-staging-observer/node
test ! -e /etc/systemd/system/barber-staging-backup.timer
test -f "$source_root/test-installation-review.json"
/opt/barber-staging-observer/node --input-type=module -e '
  import assert from "node:assert/strict";
  import { readFileSync, lstatSync } from "node:fs";
  const path = process.argv[1] + "/test-installation-review.json";
  const stat = lstatSync(path); assert.ok(!stat.isSymbolicLink() && stat.uid === 0 && (stat.mode & 0o077) === 0);
  const review = JSON.parse(readFileSync(path));
  assert.equal(review.kind, "reviewed-test-operations/v1");
  assert.equal(review.policyTestsPassed, true); assert.equal(review.repositoryChecksPassed, true);
  assert.equal(review.separateReviewPassed, true); assert.equal(review.allFiveCiPassed, true);
  assert.match(review.sourceCommit, /^[a-f0-9]{40}$/);
  assert.ok(Date.now() >= Date.parse(review.reviewedAt) && Date.now() - Date.parse(review.reviewedAt) < 86400000);
' "$source_root"
mkdir -m 700 "$target" "$target/runtime" "$target/runtime/scripts" "$target/runtime/ops" "$target/runtime/ops/staging-vps"
for module in "$source_root"/scripts/*.mjs; do
  test ! -L "$module"
  install -m 600 "$module" "$target/runtime/scripts/$(basename -- "$module")"
done
install -m 600 "$source_root/ops/staging-vps/barber-staging-cloudflared.service" "$target/runtime/ops/staging-vps/barber-staging-cloudflared.service"
install -m 600 "$source_root/test-installation-review.json" "$target/installation-review.json"
/opt/barber-staging-observer/node "$target/runtime/scripts/test-environment-control.mjs" --initialize
# initialize refuses any existing state/runtime record; no service is restarted.
