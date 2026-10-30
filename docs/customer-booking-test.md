# Customer booking in local Test

Open http://localhost:5173/book. This implementation is on
`codex/customer-booking-test` in the checkout that owns the existing local
`barber-local-test` stack. Nothing has been pushed, merged or deployed to live.

Customer-facing wording now uses shop (صالون); technical identifiers below remain unchanged.
Customer accounts and phone recovery are described in `customer-accounts-test.md`.

The customer journey has three screens:

1. **Find a branch:** choose a city. Search and logo rows appear on the same
   screen immediately after city selection. Select a branch and continue.
2. **Your appointment:** choose a barber first. Their services appear below;
   select one or more services to reveal available dates and times. Choose a
   time. Completed sections collapse to summaries with Edit controls. Continue.
3. **Confirm booking:** review the appointment summary and enter name, GCC
   mobile number and optional notes. Get the verification code, enter the
   six-digit **Test code displayed on this same screen**, then select
   **Verify & confirm booking**. No SMS is sent and there is no separate review
   or verification screen.

After success, a receipt shows the reference and calendar download. Payment is
at the shop. The branch manager can see the confirmed booking.

Price, duration and the primary action stay in the mobile footer. Changing the
city clears branch/barber/services/time; changing the barber clears incompatible
services and time. Editing unchanged selections preserves them. A taken slot
returns to date/time with customer details and verified identity retained.
Uncertain network retries reuse the verified booking ID to avoid duplicates.

English and Arabic copy, right-to-left layout rules, responsive branch rows,
keyboard focus after section transitions, loading/error/empty states and recovery
from a taken slot are implemented. Visual browser acceptance is pending; see `../design-qa.md`.

The demo seed adds City Centre, Seafront, Market Street and a Salmiya branch,
their services and barbers. It preserves existing synthetic fixtures. The three
generated logos are sample artwork; branches use their existing `image_url`
field for logos. These fixtures are included only in the local seed command.

The `/book` route and landing-page entry appear only for Test. The guest Edge
Function additionally requires development/test, loopback frontend/backend URLs
and a server signing secret. `local:start` maintains the ignored local Functions
variable `CUSTOMER_BOOKING_TEST_API_URL`. No production variable is required.
The Test verification simulator is not a production SMS integration.

The gateway reads an explicit public catalogue projection, exposes no customer
records or staff contacts, and calls a service-only database function. Existing
anonymous and authenticated table policies are unchanged. The migration adds a
booking overlap exclusion constraint that also covers staff booking writes.
Before any future production release, review existing overlaps and compatibility
with the pinned production backend separately; no release is part of this task.

Validation on 30 October 2026 (including the three-screen revision):

- `npm run check`: passed (lint, Function checks, 62 Function tests, 34 app tests,
  41 operational tests, migration/domain checks and build).
- `npx supabase test db --local`: passed, 167 assertions in seven files.
- `npm run check:schema`: passed; expected public schema updated.
- New migration replayed transactionally against owned Test, preserving data.
- `node scripts/probe-customer-booking.mjs`: passed against the running API:
  catalogue privacy, service ownership, available slots, code verification,
  simultaneous booking conflict, calculated prices, idempotent retry, manager
  visibility and cross-tenant denial. Three consecutive runs passed after fixing
  an observed deadlock response: a rolled-back transaction is retried once with
  the same signed booking ID, then follows normal slot-conflict recovery.
  Regression checks cover deadlock/serialization retry, conflict after retry,
  bounded retry and no replay of unrelated failures. Probe data is removed.
- Database lint reports no issue in the new function. It still reports existing
  missing `auth_rate_limits` references in `check_auth_rate_limit` and
  `reset_auth_rate_limit`; those unrelated routines were not changed.
- Browser visual checks and screenshots remain blocked by the browser runtime
  reporting local browser use disabled, including after the user confirmed the
  Browser plugin enabled and localhost set to Always allow.

The integration probe asserts the exact loopback API URL and checks local stack
ownership before using the socket-bound Docker helper. It only uses synthetic
data and rolls back/removes its mutations. Do not point it at another backend.
