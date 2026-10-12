# Barber++ shared Test environment

The owner approved this policy on October 11, 2026. It supersedes the Env3
daily-backup closure contract. Historical execution and recovery failures remain
in `env3-closure-status.md`; the transition result is `test-environment-status.md`.

## Identity and boundaries

The Mac is the development workstation. Test uses srv1207055, 185.97.146.8,
2 CPU / 8 GiB / 100 GB, with the existing isolated Supabase backend and frontend.
Production is a separately authorized environment. Test is best-effort and may
have announced interruptions. No production data or shared secrets are permitted.

The visible label is translated `TEST — synthetic data`. Compatibility identifiers
remain `APP_ENV=staging`, GitHub environment `staging`, existing Docker names,
paths and staging-barber/supabase-staging.malabdullah.cloud. Do not replace the
runtime value with `test`: local-only validation uses that value differently.
Browser HTTP/WSS uses the app's existing same-host API routing. Access remains
default-deny; only the two exact API-host signed Meta paths retain exceptions.
AI/WhatsApp sends and the cron launcher remain disabled; SMTP goes to Mailpit.

## Manual deployment and acceptance freeze

Use local development, a reviewed PR, all five required CI checks, owner approval
of the specific release, immutable images, then manual deployment. Automatic
workers remain disabled. The source must be reachable from protected main.

Root-only controller on the Test VPS:

```
/opt/barber-staging-observer/node /opt/barber-staging-test-operations/runtime/scripts/test-environment-control.mjs --inventory
```

`--freeze` binds acceptance to all nine image identities, commit, complete
migration hashes and five configuration hashes. `--open` invalidates the freeze
before further work. Mutation commands reject a frozen state, even for a matching
candidate. Existing capture checks the state twice, including after acquiring
the shared lock. Direct root/Docker commands are outside this guard: operators
must use this preflight/reservation procedure; it is not a root security boundary.

`--preflight frontend|stateful|reset|maintenance` reads one bounded JSON request
through stdin: candidate, checkpoint (null for frontend-only), requestedAt.
`--begin` with the same operation reserves the existing capture/maintenance lock;
run only the owner-approved release steps afterward. `--complete` verifies the
observed candidate and health, records the new runtime, invalidates acceptance
and releases the lock. No arbitrary commands, repository URLs or paths are
accepted. A preflight alone does not reserve the operation.

State is root-owned under `/opt/barber-staging-test-operations`, outside Git.
A failed operation retains its journal. Investigate and record its outcome
before explicitly archiving that exact journal; never steal a stale lock.
Opening a drifted frozen environment requires investigation rather than silently
adopting a changed candidate. QA acceptance remains separate from monitor health.

## Synthetic rebuild and checkpoints

The authoritative baseline, migrations and `staging-fixtures.mjs` initialize an
empty database with random passwords for five accounts covering four roles and
multiple tenants/branches. `rehearse-test-synthetic.mjs` creates an isolated,
labelled nine-service AMD64 stack, new secrets and volumes, replays committed
migrations, tests pgTAP/Auth/Vault/Storage/SMTP/Functions/Realtime and removes only
those resources. It uses recorded configuration and images, not live DB data.
It requires its maximum memory plus 1.5 GiB headroom and 8 GiB free disk.
Capacity failure stops before service creation; arrange a maintenance window
separately if necessary. A clean rebuild is not an independent backup restore.

Before a stateful/infrastructure change, start a reviewed change request and
create a new encrypted checkpoint with the writer-only capture. Transfer it
explicitly using `backup:staging-pull -- <id>`; require full ciphertext/age
verification and the matching VPS acknowledgement. The checkpoint must be
captured after the change request begins. Frontend-only image/runtime changes
need prior digest/configuration retention but no new DB capture. Changed
migrations, backend images, backend/bootstrap/nginx configuration classify the
operation as stateful. Do not continue after a failed capture.

Historical v1/v2 backup readers and permission/checksum/target protections stay
unchanged. New `--test-checkpoint` captures use v3, binding the installed Test
candidate, complete migration hashes and all live configuration files. The
compatible reader dispatches by explicit kind; historical constants are never
changed to make a newer release pass. The outer encrypted transfer format stays
compatible. v3 retains the 64 MiB limit and writer-only interruption behavior.

Before applying the reviewed reminder migration, install its reviewed v3
checkpoint/recovery support. It binds the no-login writer to the exact migration
hash and recreates only that validated role before import into fresh labelled
targets. Do not alter existing roles or broaden historical readers. See
[migration and recovery preparation](test-booking-reminder-fix-2026-10-11.md).

There is no daily backup schedule or 24-hour recovery promise for Test. New
synthetic records can be lost. Preserve all existing archives, incident pins,
Apple Passwords key recovery and exact custom image archives. Future cleanup
must explicitly enumerate validated eligible directories, protect the latest
two verified checkpoints and incident/rollback points, and confirm removals.
No automatic pruning is installed. Resetting shared Test remains an explicit,
resource-specific operation; a failed deployment never automatically resets it.

## Monitoring and maintenance

The reviewed Mac launch agent `com.malabdullah.barber-test-operations` runs at
load and every 900 seconds from frozen source in BarberTestOperations under
Library/Application Support. It observes HTTPS/Access, recorded runtime,
container health, tunnel, disk, private-origin drift, operation locks,
certificate/credential expiry and security reviews. It never transfers backups,
writes VPS receipts, prunes or deploys. Its private status includes healthy,
degraded, failed or unknown; productionApproved is always false.

New/worsened failures and recovery notify through the pinned registered macOS
helper. Offline/asleep periods have no immediate alerts; a gap is reported at
resume. Disk warns at 75% and fails at 85%; expiries warn at 14 days and fail at
7. An unavailable observation is unknown. Keep logs/private status outside Git.

`--maintenance <reason-code>` records at most 15 minutes against the current
candidate; `--end-maintenance` clears it after verification. Only availability
is suppressed. Access, isolation, origin drift and security remain observable.
Expired windows and failed operation locks require investigation. No firewall,
DNS or tunnel route is changed automatically.

The owner answers alerts and verifies credentials. Installation receipts must
record actual local/CI tests, code review, notification delivery and interface
checks. Install only monitoring; leave the daily VPS backup timer absent/disabled.

## Security, release acceptance and rollback

Weekly and before component changes, assess unsuppressed findings against the
exact artifacts/exposure. Root-owned security.json binds the candidate and scan
hash, review date, disposition completeness and expiry. A missing/stale/incomplete
review is failed; a healthy monitor never approves production. Realtime's
existing deadline is October 18, 2026 at 03:00 Kuwait; new findings are not
automatically covered. No acceptance extension or shutdown is automatic.

Before acceptance, freeze the candidate and run four-role journeys, direct
tenant/branch API denials, Storage/Realtime controls, email sink/outbound checks,
Chromium/Firefox/WebKit, 360/390/430 mobile widths, tablet, breakpoint and desktop,
English/Arabic, both themes and drawer keyboard/focus/scroll checks. Owner iPhone
acceptance covers Access/login, navigation, language/theme, booking, rotation
and logout. Critical/high functional defects block acceptance; lower defects
need explicit recorded owner acceptance. Security findings need current specific
dispositions. A fix ends the freeze and starts new acceptance evidence.

Rollback uses the prior approved image/configuration and never reverses database
migrations automatically. Stateful failures require a reviewed forward fix,
checkpoint recovery or explicit synthetic rebuild decision. The old cross-origin
login configuration is not a healthy fallback. Production promotion has separate
backup, recovery, migration and release approvals.
