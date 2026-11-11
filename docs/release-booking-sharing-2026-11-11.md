# Selective booking sharing/defaults production candidate

Owner requested the Live iOS app receive all accepted sharing and booking
notification updates, explicitly excluding Announcements. This candidate starts
from production main 5fe3df830adeaa638f557b789d5b235e65785ae4 and excludes
PR98/announcement tables, Functions, admin UI, consent and unfinished Phase2.
It reuses accepted sharing source 55eae55a516bedfc2330696ea5ad39c2f24fd078,
plus the separately applied Test booking-default migration from 8ff657e.

## Changes

- Immutable server-created public booking snapshots; previous URLs freeze at
  migration-visible details, unchanged details reuse a version, changed public
  details get a new URL, fixed expiry and live ownership protections retained.
- Share booking directly opens platform sharing; browser Copy/selectable-link
  fallback only, no customer management, preview, expiry or Stop sharing UI.
- All four booking categories default on for future rows only. Existing saved
  choices and notification enable/replay boundaries are unchanged.
- No Function/config/provider-secret changes, notification send or owner-data
  mutation is included. Legacy share IDs/hashes/revocation state are preserved.

## Exact migrations

- 20261111102111_booking_share_snapshots.sql: `6952aa0e94a55a498b15cb4f4c800b1e15fc525648d9202b281a179271ba81cb`
- 20261111113413_booking_notification_defaults.sql: `dec33c971aa126ff1e7179f3b7f2e3916e0889f66b3d744e1fd140283d9bbd06`

The snapshot migration adds private version storage/RLS/immutability protection,
backfills existing shared copies and updates the service-only sharing routine.
It requires the separately reviewed release path, not the automatic additive-SQL
subset. Original storage is retained. Do not revert the sharing routine to its
old dynamic reader: that would invalidate new versions and privacy/revocation
semantics. Prior frontend/Functions remain compatible for rollback while retaining
SQL/customer writes. No baseline replay or destructive database reset.

## Verification

The exact sharing files are identical to the accepted hosted Test version;
bookingShare translations only were selected, excluding announcement locales.
Public schema expected changes only the sharing routine/comment. SQL043 checks
announcement consent only when that unrelated routine exists; the standalone
production scope does not require it. Default migration itself is unchanged.

Local npm run check passed (application/Functions/operational tests, lint and
build). Full protected PR CI must pass, including migration/schema replay,
exact production image and browser checks. Hosted Test already exercised real
reschedule/cancel/version/revoke and native default/opt-out paths; production
QA stays read-only. No Test phone fixture/provider bypass is promoted.

Before application: reconcile actual production migration/hash prefix, running
images, current original backup/restore receipt, Functions and rollback artifacts.
Finish actual HTTPS/runtime/image verification after release; only then install
the native Live update in place preserving its account/preferences and Test app.
No production release has been performed by writing this candidate.
