# Test environment transition — October 11, 2026

Status: implementation in progress; no ready/acceptance claim.

The approved Test policy replaces the prior Env3 operational closure contract.
Daily backups/transfers/pruning, 26/30-hour freshness gates, two daily cycles,
48-hour observation and monthly full restore requirements are retired for
disposable Test data. The failed Mac Realtime restore remains unresolved.
Production backup/recovery remains outside this transition.

## Baseline

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

Pending: latest CI and final review evidence; live monitoring
installation/supervised/scheduled/resume evidence;
security dispositions (see `test-security-dispositions-2026-10-11.md`); exact
release approval/deployment and final browser/iPhone
acceptance. No production resources or current application images changed.
