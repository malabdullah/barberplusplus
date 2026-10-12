# Test security hardening preparation — October 12, 2026

Status: PR #10 merged as `051acef07e4405b46a2c51952775b968acdfb968` with
owner merge/build-only approval; published images tested but not deployed. Live Test
retains source 7ddcfe45 and its five-migration acceptance freeze. Production,
shared data, secrets, routes and automatic workers are unchanged.

## Correction and scope

CLI-created migration `20261012045130_harden_legacy_function_paths_and_rate_limits.sql`
has SHA-256 `c63c118b3aade20a259b609e1b6e9f692307eedbd1538bd33f1910412f63e273`.
It fixes eight assessed function paths with builtins first, trusted schema next
and temporary schema last. API roles cannot CREATE public objects. Browser,
anonymous and default-PUBLIC execution of the two rate-limit functions is revoked;
service_role retains explicit execution without owner elevation. No new role,
table, policy, argument or return type; the private booking writer is unchanged.

The optional rate-limit store is absent in the authoritative baseline and live
Test. The old worker returned an invented allowance on failure. No frontend
caller was found; normal login uses Supabase Auth separately. The worker now
returns HTTP 503 / allowed:false on storage/configuration/backend failure, limits
streamed input to 4 KiB even with absent/false Content-Length, rejects malformed
and prototype-name input, preserves server-selected thresholds and genuine denial,
and never echoes backend details. Custom limiter storage/activation remains
deferred, not claimed operational. No missing table was invented.

References: [PostgreSQL function security](https://www.postgresql.org/docs/17/sql-createfunction.html)
and [Supabase function privileges](https://supabase.com/docs/guides/database/functions).

## Actual validation

- Complete local check/build passed. 34 Deno tests include 20 limiter tests.
- Operations/backup compatibility and four new static/rehearsal safety tests pass.
- 13 Chromium journeys and eight WebKit responsive/language/theme checks pass.
  Final Linux CI in all three engines is still required.
- Exact compiled pinned AMD64 runtime at Functions source a9d51ec booted all
  eight workers and verified storage-unavailable denial, streamed-size rejection,
  JWT, cron, Meta, encrypted Flow and disabled outbound behavior.
- Separate native nine-service clean rebuild passed six migrations, 94 pgTAP
  assertions, five Auth logins, fresh Vault encryption, private Storage, sink
  email, frontend, Functions and Realtime delivery/tenant denial. The advisor
  stdout file was subsequently found empty, so its string-absence check does
  not prove a zero-warning assessment. That evidence gap is not a pass. The rebuild used the earlier
  fail-closed Functions image at 02b2e05, before the independently tested body-size
  addition; that distinction is retained rather than conflating artifacts.
- Live container identities and acceptance-freeze bytes stayed unchanged. Only
  labelled disposable containers, volumes and network were removed. This is
  synthetic reconstruction, not independent lost-server backup restoration.
- Actual public DDL now matches the fixture byte-for-byte. The first CI database
  run failed only on one trailing blank line; its generated output matched the
  native export. Only that formatting was corrected. The strict drift validator
  is unchanged. All five PR checks and the subsequent main CI passed. Main
  browser evidence includes 13 application journeys and 24 three-engine QA tests.

Private receipts and generated schema/advisors are retained on the Mac and VPS.
Preserved failures include a transfer timeout, outer-index/platform-ID assumption
(resolved by exact configuration/layer verification), two driver stops before
advisory execution caused by a missing import, and remote export failure. The
corrected export uses the fresh database socket and the exact checksum-pinned
official CLI formatter without credential arguments. Failed attempts are not passes.

Current exact-artifact scans introduce no new findings at any severity for the
previously accepted DB/Auth/Mailpit/Realtime images: 3/5/4/54 HIGH, no CRITICAL.
The archived old frontend is not the deployed frontend. Scanner coverage limits
remain recorded. Existing acceptance expires October 18 at 03:00 Kuwait, unchanged;
no acceptance of new findings or extension has been granted.

## Review and remaining gates

Separate solo-owner review checks the trusted paths, invoker/ACL changes,
unchanged booking writer/RLS, missing-store deferral, fail-closed/status behavior,
body bounds, no error/credential disclosure, image/manifest binding, capacity
preflight, labelled cleanup and unchanged live freeze. It is not independent
human review. Public code/technical-assessment publication was explicitly approved
on October 12. The owner subsequently approved merge/build only. No new image
is approved for live release. Published frontend/Functions cold-runtime probes
passed, but full-severity scans retain unaccepted matches (frontend 9 MEDIUM,
12 LOW, 2 UNKNOWN; Functions 23 MEDIUM, 8 LOW). Zero HIGH/CRITICAL or secret
matches does not resolve those findings or establish complete scanner coverage.
The explicit warning-gate control rejected all eight known live warnings with
structured output and exit status 1, without modifying the frozen deployment.
See [image/advisor follow-up](test-image-advisor-followup-2026-10-12.md).

After publication/build: verify signed immutable artifacts, obtain concrete
release approval and a fresh encrypted Mac-verified checkpoint, then perform the
compatible database/Functions transition under the operation lock. Do not restore
fail-open behavior or automatically downgrade a database. Retest the exact live
candidate, bind current security evidence, complete owner iPhone Safari checks
and obtain explicit final Test acceptance. No production-ready or always-on
monitoring claim is implied.
