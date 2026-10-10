# Env3 operating and closure runbook

Scope: private synthetic staging on srv1207055. Production and real outbound
integrations are excluded. This implementation does not activate deployment
workers. [Execution status](env3-closure-status.md) is the completion record.

## Inventory and trust boundary

- Current release/configuration: `staging-live-acceptance.md`.
- Live backend model: `/opt/barber-staging/manual-first-release/backend.private-origin.json`.
- Live frontend model: `/opt/barber-staging/manual-first-release/frontend.same-origin.json`.
- Baseline model and protected fixtures: `/opt/barber-staging/supabase`.
- Reviewed operational source installation: `/opt/barber-staging-operations`, root-owned 0700.
- Encrypted exports: `/var/backups/barber-staging/export`, root-owned 0700.
- Mac data archives: `/Users/malabdullah/BarberBackups/staging`, user-owned 0700.
- Mac image archives: `/Users/malabdullah/BarberBackups/staging-images`, user-owned 0700.
- Mac monitoring: `/Users/malabdullah/Library/Application Support/BarberStagingOperations`, user-owned 0700.

Never print Compose models, synthetic account files, decrypted bundles, tokens
or private identities. Public evidence contains identifiers, hashes and outcomes.
Keep the age decryption identity on the Mac and its Apple Passwords recovery
copy; only the public recipient belongs on the VPS.

## Prepare and verify before installation

1. Review the implementation commit and required CI. Freeze that reviewed
   source outside the checkout for VPS/Mac services; no mutable worktree symlink.
2. Inspect actual VPS configuration, image identities, mounts, internal
   networks, migration hashes, health, private origins and disabled integrations.
   Use `staging-operations-read.mjs --inventory`; it accepts no caller host/path.
3. Run negative/failure tests and a supervised capture with
   `capture-live-staging-backup.mjs --supervised`. Do not run the old bootstrap
   capture against the current live model.
4. Pull the completed export using `npm run backup:staging-pull -- <id>`.
   Require its authenticated transfer receipt; partial directories do not qualify.
5. Complete the exact image inventory with `npm run backup:staging-images`.
   Missing/different artifacts are blockers. Export source aliases are accepted
   only when their platform identity matches the reviewed artifact exactly.
6. Rehearse v2 recovery using only Mac-held data/image archives, new labelled
   volumes and an internal network. Stream age-decrypted data to
   `restore-private-staging-backup.mjs <id> --local-off-vps`; never print it.
   The receipt identifies all restored services and live-volume preservation.
   If Mac AMD64 emulation cannot run the unchanged Realtime profile, do not
   alter that profile or claim a pass; obtain a suitable isolated runtime.

The installation receipts are evidence written by the operator after these
checks, not input fixtures to manufacture success. Root/user ownership and
freshness are checked by each installer. Record the source commit/hashes and
the capture/transfer/restore receipt identifiers with the installation decision.

## Schedule and recovery

VPS: `barber-staging-backup.timer` triggers at 04:00 Asia/Kuwait with
`Persistent=false`. A late start outside 04:00–04:15 is rejected. Services stop
by their prevalidated IDs and restart by the same IDs; no recreation occurs.
The service times out after fifteen minutes; its stop handler checks the
protected journal and attempts bounded recovery of only those services.

On success, encrypted payload publication follows healthy resumption and
configuration revalidation. On failure, retain the capture lock and evidence.
Disable the timer while investigating; validate service health before manually
removing an exact reviewed failure lock. Never steal a lock or retry blind.
The same lock must be respected by manual maintenance/deployment operators.

Mac: the launch agent runs every 900 seconds and at load. An offline/asleep Mac
does not satisfy the transfer gate. Failed/interrupted transfers retain only
encrypted partial files; existing accepted destinations are revalidated.

The Mac service uses the checksum-pinned official Node 24.20.0 archive
(`40e5607e5ecb3db9192723776da2d75d966260fc74a7a9e731c1bd67dda96bc8`),
installed in its private application directory. Do not depend on the user's
default Node or replace that executable. Native notifications use the installed
Homebrew `terminal-notifier`; verify notification delivery before enabling.

## Freshness, retention and notifications

Target RPO: 24 hours, conditional on Mac availability. Warn at 26 hours and fail
readiness at 30 hours, measured from capture time rather than transfer time.
Target restore time: two hours once a suitable runtime and credentials exist.
A material release still needs its own new verified backup and owner approval.

Keep seven daily backups, the newest two restore-tested recovery points and
all pinned incident/rollback backups. Prune only explicit validated directories
with matching Mac receipt acknowledgements. Preserve untransferred exports,
unknown contents, pins and the last good copy. Image archives are never pruned
by data-backup retention. Record every removed identifier and retained recovery
points. Initial pruning waits until scheduling/transfer acceptance is recorded.

Check public HTTPS/Access/runtime, VPS health/disk, tunnel and recovery evidence
every fifteen minutes while the Mac is available. Warn at 75% disk and fail at
85%. Unknown observations are not healthy. Suppress expected availability
notifications only for a fresh capture journal in the maintenance window.
Notify on new/worsened failures and recovery; report gaps after resume.

Credential expiry inventory must be private and evidence-backed. Cloudflare's
`barber-staging-ci` token is enabled and the UI displays September 3, 2027 at
01:04 PM. Use the start of that calendar day as a conservative warning
boundary unless an exact timezone-qualified timestamp is independently read.
Verify other relevant credential metadata; never derive expiry from a secret.
Certificate expiry uses authenticated TLS inspection of the exact two hosts.

## Acceptance and maintenance

Require at least 48 hours and two consecutive scheduled capture/transfer cycles,
complete isolated recovery, passing browser/function/security tests and owner
iPhone acceptance. Screenshots and machine results must be stored durably with
the identified release; temporary folders alone are insufficient.

Review vulnerabilities weekly and before component changes. Realtime's current
exception expires October 18, 2026 at 03:00 Kuwait time; new findings, changed
images/profiles or expiry require a new disposition. No automatic renewal or
shutdown is implemented. Preserve unsuppressed findings and scan coverage.

Run a monthly isolated restore drill and one after backup-format/component
changes. The owner responds to alerts; Mac monitoring provides no immediate
notifications while offline. Owner approval closes the identified private
sandbox only; production acceptance and real integrations remain deferred.
