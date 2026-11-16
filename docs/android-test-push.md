# Android Test push integration

Test only. The website production release remains separate. Existing APNs,
iOS/web registrations and provider configuration are unchanged. This transport
has no general cron, campaign or cohort activation.

## Client contract

Use the existing Test `customer-auth` gateway. Every Android push request must
include `client: "android"`, a persisted UUID `deviceId` and a random 64-character
lowercase hexadecimal `deviceSecret`. These are private installation state;
never log them. Use the actual signed-in session; user/session IDs in request
data cannot select an owner.

The coordinator must first freeze the two task-emulator device IDs, A/B account
IDs and initial token hashes, then configure the server allowlist in capture
mode. Register only after password tests/session revocations finish. Missing
configuration returns `503 PUSH_NOT_CONFIGURED`; it does not invalidate login
or authorize automatic registration loops. Guest subscriptions are outside this
initial Android Test scope.

| Action | Additional fields |
| --- | --- |
| `push-register` | `provider: "fcm"`, `projectId: "barber-plus-plus-phone-test"`, `packageName: "com.barberplusplus.customer.test"`, actual FCM `token`, `permission` boolean, `language` (`en`/`ar`), increasing integer `version` |
| `push-status` | Current live bearer session |
| `push-preferences` | Current bearer; `preferences` with exactly `updates`, `reminder24`, `reminder2`, `reviews` booleans; optional `notificationsEnabled` boolean |
| `push-detach` | Increasing `version`; the installation capability permits detach after sign-out |

Responses contain success and permitted preference state, never a token,
capability, key or account identifier. Invalid/foreign bindings return
`400 INVALID_REQUEST` or `403 FORBIDDEN`; revoked/missing sessions return
`401 AUTH_REQUIRED`; missing devices return `409 DEVICE_REQUIRED`.
`409 TEST_BUDGET_EXHAUSTED` ends that test action without a new ID or retry.

This initial server budget permits two registrations, one actual token rotation,
two preference writes and two detaches. Counters survive session cascades and
mode changes. Stale versions cannot restore a token or detach a newer binding.
Auth session/account deletion invalidates the corresponding registration.

For the one rotation, obtain the new task token normally and pass its hash
privately through the coordinator. A service-only append operation checks the
exact existing device/account, old token hash and version before allowing that
single new hash. It cannot replace an owner, add a device or reset any quota.
The app then registers the new token with a higher version. Do not pre-delete
the initial token merely to discover a future token in advance.

## Native notification routing

Create Android channel `booking_updates` and handle notification click action
`BARBER_OPEN_BOOKING`. FCM data values are strings:

- `version: "1"`, `kind`, `destination: "book"` for a task test alert.
- `version: "1"`, booking event `kind`, `destination: "booking"`, `bookingId`
  and `eventId` for normal booking updates.

Persist the pending destination before the Test gate/sign-in screen, then
resume it after the gate. Validate environment and identifier shape. Booking
data still comes from the authenticated owner API; notification data is not an
ownership proof. Never create or mutate a booking from a tap, open production
data in the Test app, or silently switch the signed-in user.

FCM uses the Phone Test project's public SDK configuration. Google sign-in
continues using its separately approved Auth Test web audience; do not infer
that audience from the FCM project's configuration.

## Server and delivery boundary

The separate `customer-android-push-dispatch` Function requires both the existing
server-only Test service-role bearer and Test gateway secret. Neither belongs
in the app. Runtime, device and delivery tables are private with RLS; public,
anonymous and authenticated roles cannot execute the transport/dispatcher RPCs.
Only the trusted server can retrieve its separately encrypted Vault credential.

Capture is the default. Real delivery requires a later coordinator-assigned
window, up to three exact pending jobs and expiry within 30 minutes. A captured
job cannot be replayed as a real message. The database reserves at most three
total attempts before provider contact. Timeouts/unknown outcomes keep that
reservation and never automatically retry or refund it. Restoring capture does
not reset counters or permit another activation.

Only newly committed booking events after device registration are eligible;
preferences, live session, role, account status, current booking ownership and
current token are checked before dispatch. An invalid-token result disables
only the exact token binding used by that attempt. A late result cannot disable
a rotated token. There is no historical re-enqueue for testing.

The one send-only service-account key is retained privately by the coordinator
and encrypted separately in Test Vault. No key is included in the native SDK
configuration, source, responses or logs. The coordinator owns its rotation
review; another key requires separate authorization.

## Current acceptance limits

Backend unit/transaction checks and capture readiness are distinct from real
device acceptance. Real push attempts remain on hold until the coordinator
assigns the frozen task tokens and window. Email signup's definitive response
path is available; an uncertain first signup response remains a deferred
limitation. Preserve its original local context, do not repeat signup or adopt
an unknown callback request ID. The server still generates request IDs and
pending handles; client-assigned locator changes are not deployed.
