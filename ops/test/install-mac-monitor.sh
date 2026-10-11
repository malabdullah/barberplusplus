#!/bin/sh
set -eu
umask 077
test "$(uname -s)" = Darwin
test "$(id -un)" = malabdullah
test "$#" = 1
vendor_archive=$1
case "$vendor_archive" in /private/tmp/barber-node-24.20.*/node.tar.gz) ;; *) exit 1 ;; esac
source_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
test -f "$source_root/test-installation-review.json"
test ! -L "$vendor_archive"
root='/Users/malabdullah/Library/Application Support/BarberTestOperations'
agent='/Users/malabdullah/Library/LaunchAgents/com.malabdullah.barber-test-operations.plist'
test ! -e "$root"
test ! -e "$agent"
test ! -e /Users/malabdullah/Library/LaunchAgents/com.malabdullah.barber-staging-operations.plist
node --input-type=module -e '
  import assert from "node:assert/strict";
  import { readFileSync, lstatSync } from "node:fs";
  import { createHash } from "node:crypto";
  const review = JSON.parse(readFileSync(process.argv[1] + "/test-installation-review.json"));
  assert.equal(review.kind, "reviewed-test-operations/v1"); assert.equal(review.policyTestsPassed, true);
  assert.equal(review.repositoryChecksPassed, true); assert.equal(review.allFiveCiPassed, true); assert.equal(review.separateReviewPassed, true);
  assert.equal(review.vpsInterfaceVerified, true); assert.equal(review.notificationTestPassed, true);
  assert.ok(Date.now() >= Date.parse(review.reviewedAt) && Date.now() - Date.parse(review.reviewedAt) < 86400000);
  const stat = lstatSync(process.argv[2]); assert.ok(stat.isFile() && !stat.isSymbolicLink());
  assert.equal(createHash("sha256").update(readFileSync(process.argv[2])).digest("hex"), "40e5607e5ecb3db9192723776da2d75d966260fc74a7a9e731c1bd67dda96bc8");
  const { verifyNotifier } = await import(process.argv[1] + "/scripts/staging-mac-notifier.mjs"); verifyNotifier();
' "$source_root" "$vendor_archive"
mkdir -m 700 "$root" "$root/node" "$root/runtime" "$root/runtime/scripts"
tar -xzf "$vendor_archive" --strip-components 1 -C "$root/node"
test "$("$root/node/bin/node" --version)" = v24.20.0
for module in "$source_root"/scripts/*.mjs; do
  test ! -L "$module"
  install -m 600 "$module" "$root/runtime/scripts/$(basename -- "$module")"
done
install -m 600 "$source_root/test-installation-review.json" "$root/installation-review.json"
plutil -lint "$source_root/ops/test/com.malabdullah.barber-test-operations.plist"
install -m 600 "$source_root/ops/test/com.malabdullah.barber-test-operations.plist" "$agent"
launchctl bootstrap "gui/$(id -u)" "$agent"
launchctl print "gui/$(id -u)/com.malabdullah.barber-test-operations"
