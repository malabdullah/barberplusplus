#!/bin/sh
set -eu
test "$(uname -s)" = Darwin
test "$(id -un)" = malabdullah
test "$#" = 2
test "$1" = --install-reviewed
vendor_archive=$2
case "$vendor_archive" in /private/tmp/barber-node-24.20.*/node.tar.gz) ;; *) exit 1 ;; esac
test -f "$vendor_archive"
test ! -L "$vendor_archive"
test -x /opt/homebrew/bin/terminal-notifier
test -x /opt/homebrew/opt/node@24/bin/node
source_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
state_root='/Users/malabdullah/Library/Application Support/BarberStagingOperations'
agent_path='/Users/malabdullah/Library/LaunchAgents/com.malabdullah.barber-staging-operations.plist'
test ! -e "$agent_path"
test ! -L "$state_root"
mkdir -p "$state_root"
chmod 700 "$state_root"
test -f "$state_root/installation-ready.json"
/opt/homebrew/opt/node@24/bin/node --input-type=module -e '
  import assert from "node:assert/strict";
  import { readFileSync, lstatSync } from "node:fs";
  const path = "/Users/malabdullah/Library/Application Support/BarberStagingOperations/installation-ready.json";
  const stat = lstatSync(path); assert.ok(!stat.isSymbolicLink() && stat.uid === process.getuid() && (stat.mode & 0o077) === 0);
  const receipt = JSON.parse(readFileSync(path));
  assert.equal(receipt.kind, "reviewed-staging-mac-installation");
  assert.equal(receipt.failureTestsPassed, true); assert.equal(receipt.notificationTestPassed, true);
  assert.equal(receipt.vpsInterfaceVerified, true);
  assert.ok(Date.now() - Date.parse(receipt.reviewedAt) >= 0 && Date.now() - Date.parse(receipt.reviewedAt) < 86400000);
'
test ! -e "$state_root/node"
/opt/homebrew/bin/node -e '
  const fs=require("node:fs"),crypto=require("node:crypto"),assert=require("node:assert/strict");
  const stat=fs.lstatSync(process.argv[1]); assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.uid===process.getuid());
  assert.equal(crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"),"40e5607e5ecb3db9192723776da2d75d966260fc74a7a9e731c1bd67dda96bc8");
' "$vendor_archive"
mkdir -m 700 "$state_root/node"
tar -xzf "$vendor_archive" --strip-components 1 -C "$state_root/node"
test "$("$state_root/node/bin/node" --version)" = v24.20.0
test ! -e "$state_root/runtime"
mkdir -m 700 "$state_root/runtime" "$state_root/runtime/scripts"
# Frozen source outside checkout: no symlink to a mutable worktree.
for module in "$source_root"/scripts/*.mjs; do
  test -f "$module"
  test ! -L "$module"
  install -m 0600 "$module" "$state_root/runtime/scripts/$(basename -- "$module")"
done
mkdir -m 700 "$state_root/runtime/ops" "$state_root/runtime/ops/staging-vps"
install -m 0600 "$source_root/ops/staging-vps/barber-staging-cloudflared.service" "$state_root/runtime/ops/staging-vps/barber-staging-cloudflared.service"
plutil -lint "$source_root/ops/staging-mac/com.malabdullah.barber-staging-operations.plist"
install -m 0600 "$source_root/ops/staging-mac/com.malabdullah.barber-staging-operations.plist" "$agent_path"
launchctl bootstrap "gui/$(id -u)" "$agent_path"
launchctl print "gui/$(id -u)/com.malabdullah.barber-staging-operations"
