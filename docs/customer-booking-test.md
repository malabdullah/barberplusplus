# Customer booking in local Test

Open http://localhost:5173/book. This implementation is on
`codex/customer-booking-test` in the checkout that owns the existing local
`barber-local-test` stack. The booking-only revision is pushed to dev at `c74a849`. Customer accounts
remain local to this Test branch; live has not changed.

Customer-facing wording now uses shop (صالون); technical identifiers below remain unchanged.
Customer accounts and phone recovery are described in `customer-accounts-test.md`.

The customer journey is one page with six guided sections:

1. **City:** choose a city to collapse its section and open shop search.
2. **Shop:** search logo rows and select a shop to open its barbers.
3. **Barber:** choose a barber to open their services.
4. **Services:** select one or more services, then tap **Continue to date & time**.
   Services remain expanded during multiple selection.
5. **Date & time:** choose a date and available time to open details.
6. **Your details & confirmation:** review the summary, enter name, GCC mobile
   number and optional notes, then request verification. Enter the six-digit
   **Test code displayed in this section** and select **Verify & confirm booking**.
   No SMS is sent. Existing signed-in customers use their unchanged account
   verification behavior.

Completed sections show compact summaries and Edit controls; future sections show
what is needed first. Only one task is expanded at a time, and section changes
move keyboard focus and scroll to the current task, respecting reduced motion.
Editing unchanged selections offers Done to keep them. Changing city, shop,
barber or services clears only dependent selections. Customer details and verified
identity are preserved during appointment edits. Errors appear inside the active
section. The mobile footer shows total price, duration and the current action.

The one-page guest booking flow is now on dev. Customer account creation,
sign-in, recovery, sessions and account editing remain in this Test checkout
and are unchanged. The dev version has its existing guest header and phone
verification, without customer account dependencies.

After success, a receipt shows the reference and calendar download. Payment is
at the shop. The shop manager can see the confirmed booking.

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

Earlier backend and three-screen validation on 30 October 2026:

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

Earlier three-screen guided-section validation on 30 October 2026:

- `npm run check`: passed, including all 38 application tests, 62 Function
  tests, operational checks, migration/domain checks, lint and production build.
- Twelve booking UI tests cover the six sections, automatic collapse and focus,
  editable summaries, multiple services, date edits preserving details,
  unavailable-time and availability-request recovery, guest confirmation,
  signed-in booking restoration and Arabic RTL.
- `/book` responds successfully from the running local Vite server.
- Customer account files and `customerAuth` translations are unchanged. No
  migration, Function, service, database or environment change was needed.
- Rendered mobile/desktop/theme acceptance remains pending because the browser
  runtime still reports local browser use disabled; no visual pass is claimed.


One-page validation on 30 October 2026:

- `npm run check`: passed, including 42 application tests, 62 Function tests,
  41 operational tests, lint, migration/domain checks and production build.
- Sixteen booking UI tests cover the full one-page sequence, one active section,
  editable summaries, multiple services, preserving unchanged selections, active
  section restoration, inline errors, availability failures/conflicts, details
  retention, guest verification, signed-in booking and Arabic RTL.
- The running `/book` route responds HTTP 200. Browser setup was attempted again;
  access still reports local browser use disabled, so visual acceptance remains
  pending. No alternative browser access was used.
- Only booking UI/styles/tests/translations and booking documentation changed;
  customer account code and translations, backend, database and environment are
  unchanged. Nothing pushed to dev or deployed.


Dev promotion (30 October 2026): pushed booking-only commit `c74a849` to dev.
The isolated dev checkout passed all 15 guest booking tests and `npm run check`
(35 application, 53 Function and 41 operational tests, lint and build).
No account files, account translations, account migration, backend changes,
environment changes or production release changes were included. The complete
local Test version, including accounts, remains in this checkout. Remote main
was verified unchanged after the push.
