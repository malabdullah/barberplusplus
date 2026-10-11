# Env3 closure execution

> Superseded operating contract on October 11, 2026: the owner approved a shared
> Test environment with rebuildable synthetic data and manual checkpoints.
> This document preserves historical results, failures and security evidence.
> Current transition status: [Test environment](test-environment-status.md).
> Current procedure: [Test runbook](test-environment-runbook.md).
> Removed daily-backup/48-hour gates are policy changes, not passed tests.

Status: implementation prepared and locally validated; live installation and
final acceptance remain blocked/pending. No Env3 closure claimed.

## October 11 supervised recovery incident — service recovered

SSH access resumed without a firewall change: the owner's current IP again
matched the existing rule. All five PR #6 checks at `dd94480` passed.
The live nine-service identities and configuration hashes matched the recorded
release. No published ports, OOM events or container restarts were observed;
Auth users remained synthetic and outbound integration credentials empty.
The database cron launcher is `off` (one registered active job does not mean it
is executing). Disk utilization was 44%.

All ten recovery images now have authenticated encrypted Mac copies, including
the exact Realtime `78f25384...` artifact exported from staging. No private
recovery key left the Mac. The tested minimal tar image was imported into the
VPS image store only; no application image was replaced.

Native preflight found two issues: decimal-string Compose memory limits needed
lossless normalization to Docker's integer bytes; five root-owned migration/test
files had group-write permissions. The validator fix has rejection tests, and
the exact files were hardened to `0600` after identity/content verification.
Neither change altered database contents or live Compose models.

The supervised capture reached resumption in 33 seconds but was rejected by its
origin check. Docker assigned the same gateway container `172.21.0.9` instead of
the approved `172.21.0.5`; Storage now occupies `.5`. All nine services resumed,
but Cloudflare's unchanged API route still targets `.5:8000`, so staging API
access is affected. The failure journal is deliberately retained. No completed
backup or transfer receipt was published, and schedules remain disabled.
Owner approval has been requested to restore/pin the original private gateway
address while preserving container IDs, volumes and aliases; no automatic
Cloudflare/DNS edits or production changes are authorized by this incident.

The owner approved recovery. Docker refused static assignment on its original
auto-subnet, so no static pin was applied. Reconnecting only gateway/Storage in
the reviewed order restored gateway `.5` and moved Storage to `.9`; IDs,
volumes and aliases were preserved. Public tests passed again for all four
roles, and the ordinary owner browser loaded the synthetic barber dashboard.
The investigated journal is retained under the private VPS incidents directory.

Capture now stops every backend writer but leaves the strictly validated,
read-only frontend and gateway endpoints alive. Rejection tests cover missing,
unknown and duplicate service identities. The new supervised capture succeeded
in 24.120 seconds, with all nine services healthy afterward and both original
origins preserved. Export `staging-20261011T041322Z-e2704452`: 1,249,784 bytes,
ciphertext SHA-256
`d211e35dcdfa6322ef500e74c3947bf004f830cbb7ac4a0c97ee39b5ca1dc649`.
Transfer authentication and full native restore remain separate gates.

Transfer completed and passed ciphertext size/checksum and full age
authentication on the Mac. The data archive and receipt are private under
`BarberBackups/staging/staging-20261011T041322Z-e2704452`.
Two full Mac-only rehearsals failed at Realtime startup; the other eight
services were running (all declared health checks healthy), with no OOM events.
The unchanged exact Realtime image exited with code 1. The existing October 4
record also reproduced AMD64-on-ARM failure with upstream Realtime. No runtime
profile was weakened and no full recovery pass was manufactured. Only the
labelled disposable stacks and synthetic volumes were removed; live services
and existing Mac containers were preserved. A suitable independent recovery
runtime is now an owner decision, not an invitation to use production.

macOS refused the notification test from Homebrew's helper. A non-overwriting
copy of the same installed helper was placed in the owner's Applications
directory for registration. The agreed notifications were enabled for that
helper; its diagnostic reports authorized banners/sounds, and the labelled test
appears in its delivered-notification list at 04:25:09 UTC (07:25:09 Kuwait).
The implementation now pins its exact binary SHA-256 and checks authorization
on every monitor run. No other app notification settings were changed. Monitoring
and recurring backup schedules are still disabled, and observation has not
started. No installation-ready receipts were fabricated.

Ten authenticated image archives also passed a Mac-only tagless import,
verifying exact platform manifests, configuration bytes and runtime layers.
The importer was corrected to use Docker's returned OCI descriptor rather
than assuming a configuration-blob digest is daemon-addressable. No image tags
or existing running Mac services were replaced.

Public ingress/headers, all four synthetic role logins and tenant isolation
passed before the capture. These results do not prove post-incident health.
The full local repository check passed after a fail-open domain-scan error was
corrected and covered by four scanner-availability/error regression tests.

The October 11 artifact scan covered all ten exports, without ignore rules:
DB 3 HIGH, Auth 5 HIGH, Mailpit 4 HIGH, existing frontend 1 HIGH, Realtime 54 HIGH;
zero CRITICAL. Other artifacts had zero reported HIGH/CRITICAL, subject to the
previously documented scanner limitations. Realtime's two additional HIGH
occurrences need explicit reassessment; the prior exception is not automatically
extended to newly discovered findings. Original expiry remains October 18 at
03:00 Kuwait. No security acceptance or Env3 closure is claimed.

Approved scope: private synthetic staging on srv1207055, manual deployments,
daily backup window 04:00–04:15 Asia/Kuwait, encrypted off-VPS copies on the
owner's Mac, fifteen-minute Mac monitoring and owner iPhone acceptance.
Production and real AI/WhatsApp integrations are excluded.

## Current gates

- October 8 live evidence: `staging-live-acceptance.md`.
- Fresh VPS inspection: passed October 11; original gateway address recovered
  after the supervised capture incident described above.
- GitHub authentication and main's five strict/admin-enforced protections:
  verified with network access; no policy changes.
- Two scheduled backup cycles and 48-hour observation: not started.
- Full independent restore: blocked by Realtime on Apple-Silicon emulation;
  qualified non-production recovery runtime decision pending.
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

1. Select a suitable independent recovery runtime and pass the full v2 restore.
   SSH, configuration/resource inspection and all ten image exports passed.
2. Verify native notification authorization/delivery and remaining failure drills.
3. Record exact reviewed operational-source identities and installation approval.
4. Resolve new security findings and obtain exact-release approval after CI.
5. Register approved new release/configuration hashes in the frozen capture
   policy before changing application images; current v2 bindings cover 6217cb3.
6. Supervised live capture and verified transfer passed October 11; full v2
   restoration and remaining failure drills still block schedule installation.
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

PR #6 CI at `c92ae0e`: application, database, dependency review and browser
(including Linux Firefox) passed. Secret scanning found only two public resource
identifiers: tunnel UUID and account ID. Current wording/code was clarified and
only the exact historical commit/path/line matches were classified in the
existing `.gitleaksignore`. No rule, path, CVE or credential-value suppression
was introduced. The new head must pass all five checks again before advancement.
