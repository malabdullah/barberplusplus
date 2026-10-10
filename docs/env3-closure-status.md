# Env3 closure execution

Status: implementation prepared and locally validated; live installation and
final acceptance remain blocked/pending. No Env3 closure claimed.

Approved scope: private synthetic staging on srv1207055, manual deployments,
daily backup window 04:00–04:15 Asia/Kuwait, encrypted off-VPS copies on the
owner's Mac, fifteen-minute Mac monitoring and owner iPhone acceptance.
Production and real AI/WhatsApp integrations are excluded.

## Current gates

- October 8 live evidence: `staging-live-acceptance.md`.
- Fresh VPS inspection: blocked by SSH timeout during the October 10 attempt.
- GitHub authentication and main's five strict/admin-enforced protections:
  verified with network access; no policy changes.
- Two scheduled backup cycles and 48-hour observation: not started.
- Owner iPhone and release acceptance: pending.
- Realtime exception expires 2026-10-18T00:00:00Z; no renewal claimed.

No schedule, backup, recovery rehearsal or security rescan is considered
complete until execution evidence is recorded here.

## October 10 implementation evidence

- v2 live-release capture/validation, retained v1 reader, and nine-service restore
  support; encrypted connector configuration included without public disclosure.
- Exclusive capture journal, fixed-identity restart, failure recovery, 04:00
  Asia/Kuwait timer, strict late-start rejection and no automatic retry.
- Mac verified pull/acknowledgement, freshness/expiry/disk checks, deduplicated
  notifications, explicit failure-lock reporting and receipt-gated retention.
- Full `npm run check` passed under checksum-verified official Node 24.20.0.
  Operational safety/resumption tests: 18 passed. Backup/crypto tests: 27 passed.
- Existing five local browser journeys passed. Final Chromium/WebKit navigation
  matrix: 8 passed, each covering 8 viewports and 4 language/theme combinations.
  Test preference settings are restored. Local Firefox launch was blocked by a
  macOS sandbox/framebuffer error; Firefox remains required in Linux CI.
- Confirmed and fixed hidden-drawer focusability, Escape dismissal, Safari focus
  restoration and media-query/resize behaviour. Changes are not deployed yet.
- TIFF patch verified against Alpine's signed package repository/security feed.
  Local frontend candidate: 0 HIGH / 0 CRITICAL; 70 APK packages, no JS coverage
  from the image scanner. Shipped npm dependency audit: 0 findings.
- Minimal GNU tar candidate: 0 HIGH / 0 CRITICAL; 21 APK packages. Native Docker
  round-trip passed bytes, numeric ownership, modes, ACLs, content-type,
  cache-control and etag, including older GNU tar archive compatibility.
  Only labelled disposable volumes were removed; existing containers unchanged.
- Nine current recovery artifacts (including the replacement helper) have
  encrypted authenticated Mac copies. Exact Realtime remains unavailable locally.
- Fresh public Access/runtime/header and exact Meta rejection checks passed;
  role/tenant/Storage/Flow/WSS retests stopped before SSH credential retrieval.
- Owner reauthenticated through Cloudflare; the normal browser reached the
  synthetic barber workspace on October 10 without injected service headers.
- Cloudflare UI confirmed route order/origins and the protected four-domain app.
  Service token is enabled and displays expiry September 3, 2027 at 01:04 PM.

## Security gates discovered by fresh scans

Recorded artifact scan completed October 10 at 17:48:55 UTC. This is not proof
of current VPS identity; fresh SSH inspection still gates adoption.

| Recorded artifact | HIGH | CRITICAL | Disposition |
| --- | ---: | ---: | --- |
| Database | 3 | 0 | New Go 1.27.1 findings; review/remediation pending |
| Auth | 5 | 0 | Retained pgproto finding plus new Go/x/net findings; pending |
| Storage | 0 | 0 | Point-in-time scan; native/functional gates still apply |
| PostgREST | 0 | 0 | Scanner found no covered packages; not a full audit |
| Mailpit | 4 | 0 | New Go/x/net findings; review/remediation pending |
| API gateway | 0 | 0 | OS coverage only |
| Functions | 0 | 0 | OS coverage; native/runtime review remains separate |
| Existing frontend | 1 | 0 | TIFF; patched local candidate has zero HIGH/CRITICAL |
| Old Node archive helper | 66 | 4 | Replaced in prepared v2 code, not silently accepted |
| Realtime | — | — | Exact artifact missing; no fresh scan claimed |

Raw encrypted copies and private scan reports remain outside Git. No finding
is suppressed or risk acceptance extended. Go 1.27.2 was released October 8;
updated compatible component candidates/reachability evidence must be reviewed
before live changes or any bounded owner disposition. See the
[official release history](https://go.dev/doc/devel/release#go1.27.2).

## Remaining execution gates

1. Restore Hostinger access; inspect the exact staging SSH rule and obtain the
   plan-required separate approval before changing it. Current Mac IP observed:
   `37.37.150.202`; no firewall modification performed.
2. Fresh VPS/configuration/synthetic-data and resource validation.
3. Preserve the exact missing Realtime artifact; complete lost-host recovery.
4. Resolve new security findings and obtain exact-release approval after CI.
5. Register approved new release/configuration hashes in the frozen capture
   policy before changing application images; current v2 bindings cover 6217cb3.
6. Supervised live capture, verified transfer, full v2 restore and failure drills.
7. Install/enable the reviewed VPS/Mac schedules; two cycles and 48 hours.
8. Final live regression, iPhone review and explicit owner acceptance.

No installation-ready receipt has been fabricated. Production, live database,
DNS, application images and deployment automation remain unchanged.

## Separate implementation review pass

Reviewed commit `b380a48` for staged-only host/path bindings, image/configuration
drift rejection, private secret handling, capture timeout/restart ordering,
no-overwrite publication, scoped disposable cleanup, retention protection and
browser credential isolation. This is a separate solo-maintainer code-review
pass, not independent human review. Capture/restore/install receipts and live
release approval remain mandatory; preparation tests do not satisfy them.

The implementation intentionally rejects changed application/component models
until their concrete approved descriptors are registered in the frozen policy.
Do not weaken validators to install a different release. Native resource/profile
and actual v2 restoration tests remain required because SSH access is unavailable.
