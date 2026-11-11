# Admin push announcements — Phase 1

Hosted Test only; main and production remain unchanged until owner acceptance.
No customer inbox, dashboard notification or email is created. Admin Communications
provides compose, audience filtering, frozen preview, explicit confirmation,
background delivery and paginated sending history.

The default deployment is disabled. The service-only admin_push_worker configure
operation selects the exact existing native runtime API URL and either Test-only
capture or APNs. It does not alter booking push configuration. Capture performs
no provider request and results are labelled Captured, never Delivered or Read.
A real push test needs an exact approved recipient/message. Do not blanket-enable
announcements on existing customers or devices.

Admin requests use POST admin-push with a verified bearer plus a live admin Auth
session, verified TOTP factor and aal2 token/session. SQL independently checks
current role/session/MFA. Options, users, preview, send, history, details and
recipients are the only exposed actions. The worker/configuration RPC is not
accessible through the admin endpoint. Test calls use the existing gated Worker
and exact named function allowlist. No service or gateway key enters a client.

Customers use customer-announcements with current customer-capable bearer:
- status returns enabled (default false) and version1.
- register accepts existing deviceId/deviceSecret plus protocol version1, after
  the normal push-register succeeds. It proves the installation/account/session
  and records compatibility without changing preferences.
- preference accepts the same proof plus enabled boolean. Both register and
  preference return recipientBinding (64 lowercase hex). Status reveals no binding.
The binding is random and stable for one installation/account/Auth session;
ordinary registration refresh preserves it, an actual account/session change
rotates it. It is not an authentication capability. Native clears local binding
on detach/account switch and ignores stale callbacks.

Payload: aps.alert title/body, default sound, thread-id barber.announcements,
category ADMIN_ANNOUNCEMENT; version1, type announcement, announcementId,
recipientBinding, destination none/book/account/favourites. No bookingId, contacts,
raw account/session IDs, device secret or token. Native handles this type before
booking payload parsing, rejects wrong binding on foreground/tap, preserves valid
same-session taps and booking drafts. App-only checking cannot suppress a delayed
Lock Screen alert while the app is not running; no service extension is included.

A preview freezes matching account IDs and eligible installation generations;
send is idempotent for that preview and never expands to new devices/users. Each
claim and immediate pre-send validation checks live session, current account,
opt-in/master permission, compatibility, exact registration/token/binding,
runtime topic/environment, enabled-since cutoff and expiry. Unknown transport or
expired sending leases become Unconfirmed rather than being resent. Only explicit
provider 429/500/503 failures receive bounded retries. APNs acceptance is not proof
of delivery or reading. History is admin-only.

Audience location/date filters refer to owned appointments and their shops,
not an inferred customer home. Guests and accountless barber chairs cannot be
targeted. Multiple matching appointments never duplicate a person/device. Matching,
eligible and excluded counts are separate. Each growing list is paginated.

Keep existing Auth accounts, protected admin, account/history dispatchers and
booking email/push routines/configuration unchanged. Native integration is owned
by the iOS chat after its current task; no native production release is implied.

## Test acceptance coverage

The isolated QA accounts are separate from the protected administrator. The
transactional SQL suite exercises role/MFA and installation-proof denials,
default-off consent, master switches and OS permission, live-session checks,
Test topic/environment boundaries, manager/barber customer mode, intersecting
booking filters, frozen audiences, explicit confirmation and idempotency,
preview expiry, capture/APNs mode separation, transient retry limits and expired
leases. Every SQL fixture and settings override rolls back.

A hosted capture campaign uses one synthetic account and a fictional APNs token.
The real cron-to-Function path must finish it as `captured`, with zero accepted
provider deliveries. Browser QA covers English/Arabic, light/dark, Chromium and
WebKit at desktop, narrow and landscape widths. Native checks are coordinated
with the iOS chat on Test only. Physical APNs delivery remains a separate,
owner-approved test; capture results never establish device delivery.

## Queue and audience scale

Audience eligibility is joined in bulk with parameter-aware query planning. A
5,000-account/5,000-device synthetic hosted Test run measured approximately
0.51 seconds for audience evaluation and 2.05 seconds for the complete frozen
preview. One claimed batch remained capped at 20 even when a larger limit was
requested (about 0.32 seconds). These are Test measurements, not a production
latency guarantee. All 5,000 fixture records and network queue writes rolled back.

The dispatcher requests one server-side continuation after each bounded batch
when due jobs remain. It does not wait a minute between every batch. The minute
cron remains a recovery path. Only explicit transient provider responses are
retried (maximum three attempts); uncertain delivery is recorded as unknown and
is never automatically replayed. Consent, session, installation generation and
frozen mode are rechecked before delivery.

The existing account/device master-enabled timestamps also gate queued delivery.
Turning the master switch off and on does not resurrect an older campaign or
change the separate Announcements or booking-category choices. OS permission
re-registration must advance its installation generation, invalidating any
older frozen delivery generation. Both transitions are covered transactionally
through the normal push-preferences/register routines.

## Phase 2 — hosted Test

The composer offers immediate delivery or a scheduled date/time, always entered
and displayed in Kuwait time (UTC+3). Scheduling requires a time at least one
minute ahead and within 365 days. The 15-minute preview confirmation window still
applies. The minute cron activates due campaigns; this is minute-level delivery,
not an exact-second guarantee. Expiry is 24 hours after the scheduled time.
Confirmed schedules survive ordinary admin logout, but delivery requires their
creator to remain an active admin with a verified TOTP factor.

Saved audiences store filters privately for the creating admin (maximum 100,
unique case-insensitive name, paginated by 25). They do not save recipients or
consent. Applying one always requires a fresh audience preview and confirmation.
Individual selections/exclusions remain per-campaign. Additional filters include
barber, booking status, completed-visit counts, last completed visit before a
date, and no bookings yet. Location, shop, barber, status and booking-date filters
must match the same owned appointment. Completed counts/recency refer to all
owned completed appointments; no-bookings excludes all accounts with any owned
appointment, including cancelled appointments. Contradictory criteria are rejected.

Duplication returns an editable draft, without the previous schedule, recipient
snapshot or any delivery side effect. The admin must review and confirm again.
Cancellation stops pending recipients and invalidates pre-send validation for
claimed work. It cannot recall an alert already handed to Apple. In-flight
provider acknowledgements are retained honestly; transient errors after
cancellation cannot requeue work. Cancelled campaigns cannot be resumed.

New campaigns freeze an eligibility epoch as well as the original device,
account, binding and token hash. Ordinary native registration-version/language
refreshes retain the epoch. Token, account/session, installation, master or OS
permission transitions invalidate it. Enabled-since consent boundaries still
prevent opt-out/re-enable replay. Pre-Phase2 campaigns keep their original strict
registration-version guard. No booking push API, native payload or customer inbox
is changed by Phase2. Test remains capture-only; real APNs needs separate consent.

SQL042/043/044 run transactionally, with all fixtures and queue kicks rolled back.
Hosted acceptance separately verifies the actual cron→Function→capture path,
cancellation, duplicate drafts and saved-filter APIs using a synthetic account
and fictional device. Main and production are excluded from Phase2 deployment.

Phase2's hosted synthetic benchmark included 5,000 eligible accounts, devices and
owned completed bookings, with completed-count and last-visit filters enabled.
The complete frozen preview took about 3.8 seconds; claiming a bounded 20-device
batch took about 0.34 seconds. Device eligibility is joined before aggregation,
preventing an activity-filter join plan from rescanning the complete device-count
aggregate for every account. All benchmark fixtures and capture acknowledgements
rolled back. These are Test measurements, not a production latency guarantee.
