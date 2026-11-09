# Native customer backend release candidate

Prepared 9 November 2026 on `codex/native-production-backend`, based on live/main
`aac43fff2eb9b3a43b1e5033ca542a2bc6db9530`. This document describes a candidate,
not an authorization to deploy production. Main and production remain unchanged.

## Changes and provenance

The source reconciles the exact deployed hosted Test `customer-auth` v25,
`customer-booking` v25 and `customer-push-dispatch` v5, captured read-only before
the change. Secure password/email/session modules remain unchanged.

Three new migrations append to the accepted 68-migration production prefix:

1. `20261109090930_native_checkout_recovery.sql`: service-only closure capabilities
   and an atomic booking wrapper. Resolve and booking use the same advisory lock.
   Quote expectations are compared with the canonical booking result, including
   package discounts and extras. A mismatch rolls back every booking side effect.
   An already committed request returns its original purchased terms.
2. `20261109090931_native_cancellation_history.sql`: additive cancellation time
   and response projections; no historical row rewrite or notification replay.
3. `20261109090932_native_push_runtime.sql`: current native Test queue, ownership,
   monotonic registration, session detachment, preference activation cutoffs,
   retries/leases and retention, reconciled into a production-capable runtime.
   Existing Test tables/devices/preferences/credentials are preserved.

Recovery accepts a valid original booking capability for up to 24 hours after
its booking-proof expiry. Account recovery also requires a live session for that
account. Guest claim capabilities expire one hour after original booking creation;
recovery/retries never renew this deadline. Purchased service/package snapshots
are authoritative. No contact details, tokens or credentials appear in URLs.

## Deployment isolation and private configuration

The migration does not provision keys or activate production dispatch. Runtime
identity has no default: the operator must separately configure an exact approved
API URL, bundle topic and APNs environment. Client-supplied topics are ignored.

| Target | API URL | Topic | Allowed environments |
| --- | --- | --- | --- |
| Test | `https://qvkucvcjmojjbphlzlks.supabase.co` | `com.barberplusplus.customer.test` | sandbox only |
| Live | `https://srv1073968.hstgr.cloud` | `com.barberplusplus.customer` | explicitly provisioned sandbox and/or production |

A development-signed live app uses sandbox APNs with the live bundle ID. A
distribution-signed app uses production APNs. These are separate token namespaces.
The dispatcher validates its explicit server deployment and database runtime
before claiming jobs; no Test-to-live fallback exists. APNs keys and dispatcher
authentication stay in Vault and are readable only through service-only wrappers.
No credential was read, copied or changed during this candidate preparation.

The existing Test runtime is configured with its same sandbox topic. The new
private runtime table is deny-by-default with RLS, and only the service role can
invoke its restricted configuration wrapper. Existing Test native phone behavior,
website phone policy, private inbox and gateway remain intact. Live phone-start
must remain unavailable; real native Firebase verification uses phone-confirm.

## Verification

- Hosted Test: 18 endpoint checks, 33 native/package/permission assertions and all
  56 package regression assertions passed. Transactional fixtures rolled back.
- Native push: all 128 preference/event combinations, pause/resume cutoffs,
  account/guest transitions, leases, retries, stale revisions, cancellation,
  invalid token retirement and sign-out passed in rollback-only SQL suites.
- Frontend: 300 tests passed with two workers. Unbounded parallel runs had timing
  failures; those tests also passed individually. No application UI changed.
- Functions: 151 tests passed. Lint/type checks and application build passed.
- Operational unit checks: 63 passed. Migration naming/domain checks passed.
- Pinned production PostgreSQL image: full replay and 865 assertions passed,
  network disabled, no published ports, synthetic seeds only. Platform schema
  comes from the sanitized 31 October archive, not a fresh live database dump.
- Pinned production Functions image: all nine workers compiled and safe handler
  responses passed with synthetic settings, no published ports or live secrets.
- Test APNs/dispatch Vault entry IDs and update timestamps are unchanged.
  All native push tables have RLS. The advisor's deny-by-default/no-policy INFO
  is expected for these private tables; clients intentionally have no policies.

The endpoint run retained one detached, alerts-denied synthetic device and one
closed uncommitted attempt. It created no accounts/bookings and sent no real
SMS/email/APNs. Existing subscriptions/preferences were not deleted.

## Required production review and acceptance

Before production release, review the exact commit, migration hashes, Functions
source hashes and current live state. This adds tables/RLS/routines and therefore
requires the separately reviewed backend release path, not automatic promotion.

1. Recheck live migration prefix, schema/platform compatibility, encrypted backup,
   restore/rollback evidence and current release state using approved access.
2. Review Apple native audience/primary App ID grouping and exact native callback
   allowlists; preserve existing web and Test providers and audiences.
3. Coordinate the iOS agent's production Firebase native metadata and signed SDK
   verification evidence. A real live SMS/code acceptance requires its approved
   recipient and count. Never enable a live fictional-number/testing bypass.
4. Through an approved private channel, provision the live APNs configuration and
   dispatcher secret, then the exact live runtime/environment. Do not reuse Test
   credentials. Keep dispatch disabled until the native delivery test is approved.
5. Run required CI/review, apply only the three appended migrations and matching
   Functions artifact, and verify live web contracts read-only.
6. Perform explicitly approved native end-to-end sign-in, email return, SMS,
   booking/recovery, notification delivery/deep links and sign-out checks.
   Device receipt of a push is not established by the synthetic sender tests.

## Rollback and reconciliation

Record pre-release Functions artifact/digest, runtime configuration metadata and
actual running release. On failure, first reconcile actual applied SQL/Functions.
Disable production push in its private configuration if necessary, then restore
the previous compatible Functions artifact. Retain newly created tables, keys,
closure markers and customer writes. Do not reverse SQL, delete subscriptions,
reopen closed booking attempts or restore an old database over live writes.

For Test, the read-only v25/v5 snapshots are the rollback source. Preserve native
recovery/closure and Test push contracts: do not replace them with main's older
Functions. An APNs test failure must not retire unrelated devices. Operational
receipts and any private configuration remain outside Git.

Barber dashboard audit fixes, production provider updates, live SMS/APNs delivery
and native app installation are outside this candidate's deployed Test changes.
