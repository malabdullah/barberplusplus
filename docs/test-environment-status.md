# Test environment transition — October 11, 2026

Status: implementation in progress; no ready/acceptance claim.

October 12 execution supersedes the pending-deployment notes below: PR #8 source
`7ddcfe45b6d69da58425ed4ad1e0ddcc635303f9` frontend and its exact booking migration
are deployed after a fresh Mac-verified encrypted checkpoint. Both high functional
fixes passed live retests; all nine services are healthy and the candidate is frozen.
Security dispositions and owner iPhone/final acceptance remain pending. See
[exact release execution](test-release-2026-10-12.md), including the preserved
capture-preflight failure and two inappropriate clean-replay fixture failures.
No production change or Test-ready claim is made.

Preparation update: with owner authorization, TEST-BOOK-01 now has an isolated
validated migration and fixed-purpose writer-role recovery support. Native
five-service rehearsal passed 67 database assertions, four-role booking API
journeys, tenant/reminder denial and 35 post-logical-restore assertions. The
reviewed navigation fix is included in the combined review candidate; neither
fix is applied live. Eight legacy security-advisor warnings remain recorded,
not silently accepted. See [booking fix preparation](test-booking-reminder-fix-2026-10-11.md).

Latest execution: PR #6 merged with owner build-only approval into main
`b04eacdfd49ce7aa8c7d1a4217c9fe4394078294`; main CI and image publication
succeeded. The exact published frontend passed its isolated runtime/header/
translation probe and reported zero HIGH/CRITICAL Trivy matches. Backend risk
acceptance is explicitly recorded through October 18 at 03:00 Kuwait, with no
extension or production scope. Reviewed monitoring is installed; supervised,
notification, first scheduled and injected gap/recovery checks passed. The
owner subsequently approved and deployed that frontend only. Public role,
boundary, Storage, Functions and Realtime checks passed; ordinary browser refresh
reached the new release. Monitoring now warns about the approaching security
deadline. Live mobile QA found TEST-UI-01: the Test banner obstructs navigation.
The release remains frozen. TEST-BOOK-01 also blocks acceptance: a manager's
next-day booking creation receives HTTP 403 / SQLSTATE 42501 for
`booking_reminders`. A reviewed layout fix, database-fix scope decision,
final live QA, owner iPhone testing and final acceptance remain pending. See
[release candidate and execution](test-transition-release-2026-10-11.md).

The approved Test policy replaces the prior Env3 operational closure contract.
Daily backups/transfers/pruning, 26/30-hour freshness gates, two daily cycles,
48-hour observation and monthly full restore requirements are retired for
disposable Test data. The failed Mac Realtime restore remains unresolved.
Production backup/recovery remains outside this transition.

## Initial transition baseline — historical, before installation

- srv1207055 SSH verified; nine existing application services running/healthy.
- Original gateway/frontend origins remain unchanged after the reviewed recovery.
- VPS memory available about 5 GiB; disk 44%, about 54 GiB available.
- Daily backup timer absent; neither old nor new Mac monitor registered.
- Existing PR #6 head 6a6e0f4: browser/database/dependency/secret checks passed;
  application failed fetching Deno std from deno.land (HTTP 500).
- Accepted application commit remains 6217cb33bd9aaf32aa0fa924278f314988449f12.
- Data export staging-20261011T041322Z-e2704452 verified on Mac and acknowledged
  on VPS. All ten encrypted recovery image artifacts preserved.
- Security scan October 11: DB 3 HIGH, Auth 5, Mailpit 4, frontend 1, Realtime
  54; zero CRITICAL. New/unresolved findings require dispositions. Existing
  Realtime deadline remains October 18 at 03:00 Kuwait.

## Implementation and remaining gates

Translated Test indicator, versioned policy, candidate-bound freeze/controller,
manual operation reservations, monitor without transfer/freshness dependencies,
synthetic rebuild and fixed-purpose installers are being validated.

Full repository validation and 9 local E2E journeys passed. The native AMD64
nine-service synthetic rebuild passed at 09:39 Kuwait (receipt
`barber-test-rebuild-a00a44cd5445fc5b`): four migration hashes, 32 pgTAP checks,
five account logins, new Vault encryption, Storage, mail sink, frontend,
Functions/Flow and Realtime delivery/tenant denial. Fresh secrets/volumes were
used and only labelled disposable resources removed. Original services remained
unchanged. This is a rebuild, not lost-server restoration.
The sanitized receipt is preserved in `evidence/test-2026-10-11/rebuild.json`.

Investigated failures are preserved privately: initialization order, unexpected
Mac archive metadata and a fresh-stack WebSocket handshake. Source packaging now
verifies exact membership/hashes; the rehearsal includes a bounded WebSocket
readiness check that immediately rejects authentication/routing denials.
Local Firefox failed before opening the app (macOS plugin-container permission
and framebuffer errors). Linux CI run 38119419755 at 8defaf4 passed all five
checks, including Chromium/Firefox/WebKit. A final checkpoint configuration
binding and exact runtime-hash observation hardening pass is being validated;
its final head must pass the same CI gates before installation/release.

Current remaining gates: resolve TEST-UI-01 and TEST-BOOK-01 through reviewed
changes and appropriate release/checkpoint approvals, retest affected journeys,
complete owner iPhone testing and obtain explicit final acceptance. The deployed
frontend and monitoring are operational; the two high functional defects prevent
a Test-ready claim. Production remains untouched.
