# Customer accounts in local Test

Customer entry points:

- `/customer/sign-up`: name, GCC mobile number, password and confirmation.
  Email is an optional contact field. Enter the displayed Test phone code to
  create the account and sign in.
- `/customer/sign-in`: mobile number and password. The session persists across
  refreshes independently of any staff session.
- `/customer/forgot-password`: request a phone recovery code.
- `/customer/reset-password`: enter the displayed recovery code and a new
  password. A new-code link handles expired codes. Successful recovery revokes
  existing customer sessions; sign in again with the new password.
- `/customer/account`: profile, optional email, appointments, profile editing,
  password recovery and sign-out.

The booking header links to these pages. Guest booking remains available.
Returning from sign-in restores the recent shop/barber/services/date/time
selection from session storage; no name, phone, password or verification token
is written to the booking draft. Drafts expire after one hour and clear after
confirmation. Signed-in customers confirm using their verified account identity
without repeating the guest booking code step.

All non-admin translated interface wording uses **shop** / **صالون**. Admins
retain branch wording. Customer shop names and receipt/calendar locations are
also normalized; schema fields, API identifiers and admin data names stay the
same. This convention is recorded in AGENTS.md for future changes.

## Data and authorization

Supabase Auth stores phone credentials and password hashes. The trusted server
creates the `customer` role in app metadata after phone verification. The
existing public business email registration continues to create managers;
native phone registrations default to customers and require confirmation.
User-editable metadata never grants staff permissions.

Private customer accounts link a verified phone to its existing customer record
or create a new one. Customer contact email is not an Auth login/recovery
identity. It can be omitted or removed. Profile edits update the account,
customer record and Auth display name.

Customer data, code hashes, rate counters and password reset guards live in
private tables with RLS. Their data is exposed only through a service-only
account gateway. No customer-facing permission to internal notes, tags, staff
contacts or other customers' records was added. Every profile, appointment,
profile-edit and logout request checks both the trusted customer identity and
its live session. Account booking proofs are checked again when saving a booking.

Codes expire after five minutes, allow five guesses and can be consumed once.
Signup/recovery purposes cannot be exchanged. Request and sign-in limits are
stored server-side; passwords are never stored in challenge payloads. Passwords
require at least twelve characters, upper/lowercase letters, a digit and a
symbol, with a maximum of 72 bytes.

Password recovery guards the account's role while the Auth password update is
in progress. The guard is released only after success and session revocation.
On an uncertain Auth failure it remains for operator reconciliation, matching
the existing administrative password-reset safety pattern. Do not clear such a
guard blindly: first establish the Auth update outcome and trusted role, then
revoke sessions and release that exact guard.

## Local runtime and release boundary

This is implemented only in the owned `barber-local-test` stack and Test routes.
Both guest Functions independently reject production/non-loopback settings.
Codes are deliberately displayed in local Test and **no real SMS is sent**.
No SMS provider was enabled. Before any production release, a real phone
verification/delivery integration must replace the simulator and receive its
own release/compatibility validation. No live deployment is authorized here.

The CLI disables phone Auth when no SMS provider is configured. Local startup
now sets only `GOTRUE_EXTERNAL_PHONE_ENABLED=true` on the owned, pinned-image Auth
container so phone/password login works with the independent Test verification
flow. Confirmation stays required for native signups; provider credentials and
real messaging remain disabled. The helper preserves local ownership checks,
the Docker endpoint, container image/configuration and all database volumes.
`CUSTOMER_BOOKING_TEST_API_URL` is also available to the default local Edge
runtime so the Test gateways work after `local:start` without an extra server.

## Verification

- `npm run check`: lint, Functions type/security checks, 62 Function tests,
  34 app tests, 41 operational tests, migration/domain checks and build.
- `npx supabase test db --local`: 167 database assertions, including code expiry,
  retry counters, rate limits, replay denial, role isolation, private gateway
  permissions, recovery guards and session revocation.
- New account migration replayed inside a rollback transaction; existing data
  retained. Public expected schema updated and `npm run check:schema` passed.
- `node scripts/probe-customer-auth.mjs`: real local Auth/DB sign-up with/without
  email, phone/password login, optional profile edits, customer isolation,
  metadata spoof denial, authenticated booking, private appointment history,
  recovery/replay denial, old access/refresh-token rejection, new-password login
  and current-session logout. Its synthetic users/bookings/customers are removed.
- Existing guest booking/concurrency probe passes with the new account feature.
- Security advisors and private-function lint checked separately.
- Browser-rendered mobile/desktop/Arabic acceptance remains unverified because
  the browser runtime still reports local browser use disabled. See
  `../design-qa.md`; HTTP/build/jsdom success is not visual acceptance.
