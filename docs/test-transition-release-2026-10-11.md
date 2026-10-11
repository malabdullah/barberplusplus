# Test transition release candidate — October 11, 2026

Deployed with explicit owner approval; acceptance is blocked by TEST-UI-01 below.
This is a frontend-only manual release.

## Reviewed artifacts

- PR [#6](https://github.com/malabdullah/barberplusplus/pull/6), reviewed head
  `cea84b3ac163b89cdd0893a46f9ab999ae5a646a`; all five required checks passed.
- Owner approved merge and image publication only. Main merge commit:
  `b04eacdfd49ce7aa8c7d1a4217c9fe4394078294`.
- Main [CI 38121904309](https://github.com/malabdullah/barberplusplus/actions/runs/38121904309)
  succeeded. [Build 38122366836](https://github.com/malabdullah/barberplusplus/actions/runs/38122366836)
  published both images; its protected release-request job still awaits approval.
- Proposed frontend:
  `ghcr.io/malabdullah/barberplusplus@sha256:9b78eda91e268c8bda411a099f9f27a3a3fe7e3ad2562718b02b341a61dba9ad`.
- Published but not proposed for deployment: Functions
  `ghcr.io/malabdullah/barberplusplus-functions@sha256:487a022ced7c6c981f196965a06c864a1e404876b3542e95ab44d36c9146ea55`.
  Functions, backend configuration and migrations did not change from the live
  release; preserve their current identities rather than replace them needlessly.

The exact published frontend passed a local isolated probe: health, staging
runtime/release, UID 101, same-host CSP/WSS, no-store runtime, noindex, nosniff
and English/Arabic Test indicator. Trivy 0.74 reported zero HIGH/CRITICAL matches
for its 70 Alpine packages. Language package inventory was empty; this is not
a comprehensive source audit. Raw report is retained privately with recovery
artifacts, not used as proof of live acceptance.

## Backend risk decision

The owner explicitly accepted the findings assessed in
`test-security-dispositions-2026-10-11.md` for the exact existing DB, Auth,
Mailpit and Realtime images in private synthetic Test. The deadline remains
**October 18, 2026 at 03:00 Kuwait / 00:00 UTC**. All listed controls and
per-advisory limitations remain. Production, new findings/images, the existing
frontend TIFF finding and any automatic deadline extension are excluded.

Private owner decision receipt is held on the Mac and VPS as
`backend-risk-acceptance-20261011.json`, SHA-256
`c0a2cef3e831957b2d5bbe2c093a1ff77a9f644ea851d3aea2e7a25b36aadaa3`.
It is not permission to deploy. Security completeness stays false for the old
live frontend until the replacement and its actual running identity are verified.

## Operations evidence

Reviewed frozen monitor source is installed outside the checkout on the Mac and
under `/opt/barber-staging-test-operations/runtime` on srv1207055. Its launch
agent runs every 900 seconds. Supervised observation, notification delivery,
first scheduled observation (07:50:57 UTC), and timestamp-only gap/recovery
fault injection passed. No actual Mac sleep is claimed by the fault test.
The scheduled run exited zero, observed healthy services/Access/isolation and
correctly reported the incomplete security disposition. Monitoring health does
not imply release acceptance. The daily backup timer remains absent.

The original nine-service deployment, gateway/frontend origins, volumes,
encrypted checkpoints and recovery images remain preserved. The accepted
runtime is still `6217cb33bd9aaf32aa0fa924278f314988449f12`.
Native synthetic rebuild evidence remains in `evidence/test-2026-10-11/rebuild.json`;
the failed independent Mac restore is not resolved by this release.

## Proposed owner-approved operation

1. Recheck private inventory, open state, security scope and all-five CI; reserve
   the existing operation lock for a frontend-only candidate. No new database
   checkpoint is needed under the approved Test policy.
2. Retain the current frontend digest, model, runtime configuration and old
   container for rollback. Prepare the exact new digest and change only the
   frontend image and release value. Preserve the same-host API/CSP/nginx model.
3. Replace only the frontend during a bounded maintenance window. Preserve the
   existing private origin `172.22.0.2:8080`; verify it before continuing. Do not
   change Cloudflare, DNS, firewall, backend or volumes to accommodate drift.
4. If health/origin/runtime checks fail, restore the previous frontend and its
   matching runtime/model. Keep the old same-host configuration; do not fall
   back to the defective cross-origin setup. No database downgrade/reset.
5. Verify the new actual artifact, update the candidate-bound security record,
   complete the operation, freeze for acceptance and run final live browser,
   functional, isolation and outbound checks. Owner iPhone testing and explicit
   final acceptance remain required.

## Execution and acceptance blocker

The owner approved deployment and the protected release request. Attestation
verification passed for the exact source/workflow/digest; workflow 38122366836
completed. Deployment at 08:36:27 UTC preserved all non-target containers and
the private origin. Candidate identity is
`8fe2edaa4b46edb405779ae120c8596a82d71c7b0d6b700daa851a750f9250bb`.
Prior frontend is stopped and retained as
`barber-staging-frontend-rollback-6217cb33`, with private model/runtime copies.

Public role/tenant, header/Access, exact signed Meta/Flow, Storage and Realtime
checks passed on the new release; the original synthetic booking note was
restored. Thirty REST reads at concurrency three had zero errors and p95 235 ms
(not full capacity acceptance). The owner's cookie-only browser refresh reached
the synthetic barber dashboard with the Test label; no machine headers were
injected there. Security now binds the verified replacement and explicit backend
acceptance; monitoring reports degraded for the approaching October 18 deadline.

**TEST-UI-01 — high, maintainer-owned, open:** at the ordinary browser's 476×827
viewport, the banner occupies y=0–33.27 while navigation occupies y=11.5–51.5.
DOM hit-testing at the button center returns `environment-banner`. Sticky banner
and fixed topbar/sidebar both start at zero. Development-mode navigation tests
did not render the banner. Final acceptance is blocked; the candidate is frozen.

A focused fix measures translated/wrapped banner height and offsets shared
topbar/sidebar/dropdown positioning. Regression tests exercise the real Test
component using .invalid origins intercepted and proxied exclusively to local
synthetic Supabase; no live or production credentials/requests. The fix requires
a reviewed PR, all five checks and new release approval; b04eacd approval does
not cover another artifact. Owner iPhone testing remains pending.

**TEST-BOOK-01 — high, maintainer-owned, open:** a synthetic manager can log in,
refresh and read the existing own-branch fixture, but inserting a confirmed
next-day booking returns HTTP 403 / SQLSTATE 42501 for `booking_reminders`.
The baseline AFTER INSERT trigger calls `create_booking_reminder()` with caller
privileges; hardening intentionally revokes browser-role access to the reminder
table. Direct reminder access must remain denied. The failed insert rolls back;
cleanup targeted only the fresh QA UUID, not an existing booking. No live
migration was applied. A database correction requires a scope decision;
deployment needs reviewed migration/CI, a fresh verified checkpoint and exact
approval. Rebuild fixture insertion as postgres did not prove browser-role
booking creation; historical evidence is not reinterpreted as covering it.

Automatic
deployment workers, real AI/WhatsApp, production promotion and production changes
remain excluded.
