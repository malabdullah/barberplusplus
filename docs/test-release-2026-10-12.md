# Test release execution — October 12, 2026

Status: deployed and frozen for acceptance; **not Test-ready or production-approved**.
The owner explicitly approved the checkpoint, reviewed migration and concrete
Test release after approving merge/build and evidence-only attestation separately.

## Accepted execution scope and exact identities

- Main/source: `7ddcfe45b6d69da58425ed4ad1e0ddcc635303f9`, tree
  `f4be5e1d3c356757defda3911370f654318fde75` (identical to reviewed PR #8 head).
- [Main CI](https://github.com/malabdullah/barberplusplus/actions/runs/38200935482)
  succeeded. Application, database, browser and secret-scan passed; dependency
  review is PR-only and passed on the approved PR head, then skipped on push.
- [Build and attestation](https://github.com/malabdullah/barberplusplus/actions/runs/38201520327)
  succeeded. Both published signatures were verified against the repository,
  workflow and exact main source.
- Deployed frontend:
  `ghcr.io/malabdullah/barberplusplus@sha256:2bf83e66e2a67a8d3b4f5f16fb14590291b528c78d617a2d6839722bb00beff1`.
- Functions **unchanged**, still
  `ghcr.io/malabdullah/barberplusplus-functions@sha256:b748a2d51c78df994ff93e0e26066d8193d61032ee2c21cad75264c1f2bb4c35`.
  The newly published `866d27482fde9123c567cca928650bc64e235c558a6245ec3fe6d2dca0970ce6`
  Functions digest was verified but not deployed; this correction did not change Functions.
- Migration added: `20261011085658_private_booking_reminder_triggers.sql`, SHA-256
  `37877dc53acdb831f6845adc5eee7af51a3a1791d4a44a05af86f0a9ee172ca9`.
  The four preceding hashes remain those in the historical release inventory.
- Candidate: `56eeebf0a99414471274dc434468ef859fc658fbf25cdb659bf79653fa03229f`.
- Configuration SHA-256: frontend
  `3b22824837b82d0a2601e872c86904b67b23d4d9dd2d5be95f616e9441b1d372`;
  runtime `2ebaae6b5ef33de0294c0178b834162bc00b65e3623e01fb37800ef56fc18060`.
  Backend, bootstrap and Nginx hashes are unchanged from the preceding inventory.

Execution completed at **07:27:33 Kuwait / 04:27:33 UTC**. Nine services were
subsequently running/healthy, no OOM, expected private origins, no maintenance
window or operation lock. No backend image, secret, routing, DNS, production,
automatic worker or outbound integration change occurred. No reset/reseed.

## Checkpoint and investigated interruptions

Checkpoint `staging-20261012T042133Z-11e7da27` contains 1,260,024 ciphertext bytes,
SHA-256 `7ceff8dec278298c1ed12491ae8e34c586182092b4aa38f0293c063b57a20aab`.
Full age authentication and strict v3 configuration/candidate validation passed
on the Mac at 07:22:52 Kuwait; the VPS acknowledged its matching receipt.
The key remained on the Mac. This does **not** assert independent restoration.

The first capture stopped before quiescence because the exact pinned GNU tar
tool was absent. The unchanged deployment was refrozen. The tool was recovered
from its authenticated Mac image archive, with exact image/configuration identity
verified; no substitute image or weakened validator was used. The investigated
retry succeeded. Frontend and gateway remained running throughout capture;
the same writer/database containers resumed before export publication.

The migration committed transactionally with lock/statement timeouts, without
reset, reseed or Vault changes. A subsequent **clean-replay** test was incorrectly
used against populated shared Test: 30/32 assertions passed, but empty Vault and
exactly-two-manager fixture assumptions failed. Deployment stopped before frontend
replacement and retained the operation journal. Those failures remain recorded.

Investigation verified exactly one existing `bootstrap_recovery_probe`, valid
decryption, all users synthetic, all public tables protected by RLS, 123 policies,
and administrator enumeration matching the trusted current three-manager inventory.
All 35 booking-specific live assertions then passed in a rolled-back transaction;
existing user/booking/reminder counts stayed unchanged. The same operation resumed
only its frontend step; the migration was **not reapplied**. Historical clean-replay
validators remain unchanged and their failures are not relabelled as successes.

## Validation and remaining acceptance

- Main CI: 13 E2E journeys and 24 Chromium/Firefox/WebKit responsive checks passed.
- Live: Access/default-deny and exact Meta neighbors, runtime/security headers,
  all four role browser logins/forbidden routes, tenant denial passed.
- Live: same-host HTTP booking create/modify/cancel/logout and direct reminder
  denial passed for admin, manager, agent and barber. Only four newly generated
  synthetic cancelled records were retained; existing records were untouched.
- Storage bytes/anonymous denial, management/hostile-origin denial, signed
  webhook/Flow, disabled outbound activity and Realtime tenant filtering passed.
- Bounded 30-request read check: zero errors, p95 355 ms; not full capacity approval.
- Owner ordinary browser after Cloudflare reauthentication reached the synthetic
  workspace without machine Access headers. Menu hit-test passed; menu top
  48.77 px was below banner bottom 33.27 px. Drawer close/focus-return/inert passed.

Trivy 0.74.0 with October 12 data found no HIGH/CRITICAL matches in the published
frontend (70 Alpine packages) or Functions (14 Debian packages). No language
inventory was detected; this is not a complete JS/Deno application audit. Alpine
3.24 was absent from the scanner EOL list. Existing backend image findings and
eight legacy mutable-search-path warnings remain separate security obligations.

The reviewed checkpoint/recovery runtime is installed from the exact main tree;
the preceding runtime is preserved at `runtime-before-7ddcfe45` on the Test VPS.
Existing archives and recovery keys are preserved. Security disposition completeness
is explicitly false for this candidate pending database-warning sign-off. The
deadline remains **October 18, 2026 at 03:00 Kuwait**, without extension.

The installed Mac monitor ran at 07:30:41 Kuwait, detected both hosts recovered,
and honestly reported `security-dispositions-incomplete-or-stale` / failed.
It did not approve the release or change firewall/routing. This is the expected
pending-sign-off alert, not a claim that security acceptance is complete.

Pending: complete current security dispositions, owner iPhone Safari acceptance
(Access/login, drawer, English/Arabic, themes, booking, rotation, logout), and
explicit acceptance of this exact candidate and limitations. Monitoring health
must not be substituted for that acceptance. The Mac Realtime full restore
failure and production recovery readiness remain unresolved/outside this release.

## Recovery and evidence locations

Previous frontend is retained as `barber-staging-frontend-rollback-b04eacd`, with
its prior model/runtime in the private release execution directory. Rollback
requires the approved image and compatible same-host configuration, not automatic
database downgrade. Stateful recovery/forward-fix remains a separately chosen operation.

Private VPS evidence: `/opt/barber-staging-test-operations/release-7ddcfe45/execution`.
Private Mac checkpoint: `/Users/malabdullah/BarberBackups/staging/staging-20261012T042133Z-11e7da27`.
Private Mac booking evidence: `BarberTestOperations/live-bookings-7ddcfe45.json`
under Library/Application Support. Only sanitized identifiers belong in GitHub/Git.
