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
