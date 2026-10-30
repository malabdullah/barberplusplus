# Guest customer booking on dev

The customer booking journey is available at `/book` in local Test:

1. **City:** selecting a city collapses it and opens shop search.
2. **Shop:** selecting a logo row collapses the shop section and opens barbers.
3. **Barber:** selecting a barber opens their assigned services.
4. **Services:** choose one or more services, then Continue to date/time.
5. **Date & time:** choose a date and available time to open customer details.
6. **Your details & confirmation:** enter name/mobile/optional notes, request
   the displayed Test code, then verify and confirm inline.

All six sections stay on one page with one active task expanded. Completed
sections show summaries and Edit controls; unchanged choices can be kept with
Done. Section changes move focus and scroll to the active section, respecting
reduced motion. Errors appear in the active section. Prices, duration and the
current action remain in the mobile footer.

Booking selections and the active section can resume from this browser tab's
short-lived draft; personal details and verification codes are not stored there.
Availability is rechecked before confirming a restored appointment.

After confirmation, show the reference and calendar download. Payment is at the
shop. Changing the city or barber clears dependent selections. A taken time
returns to availability with the entered details retained. Uncertain network
retries retain the signed booking ID to avoid duplicate appointments.

English/Arabic wording uses shop/صالون for customer and other non-admin
interfaces; admins retain branch wording. Underlying schema/API identifiers
remain unchanged. Synthetic fixtures include shop logos, two cities, barbers
and their assigned services. Existing local data is preserved.

## Scope of this dev change

This contains guest booking only. Customer account registration, sign-in,
password recovery, customer sessions, account history/profile, account-aware
booking and the account migration remain on the local Test feature branch.
There is no dependency on the unfinished customer-account feature.

The `/book` route and entry link remain Test-gated. Its Edge Function additionally
requires development/test and loopback frontend/backend URLs. The Test code is
shown onscreen; no SMS provider or paid integration is enabled. No live website
or production Auth configuration is changed by pushing this to dev.

The booking gateway exposes an explicit public catalogue projection and a
service-only database function. Existing customer/internal staff information is
not returned. It validates shop/barber/service ownership, schedules, vacations,
time off and booking windows. Price/duration come from the database, and an
exclusion constraint prevents overlapping appointments. Rolled-back database
transactions may retry once; other failures retain their normal behavior.

The migration sets its function owner explicitly so a fresh CLI replay matches
the expected schema. Local startup supplies `CUSTOMER_BOOKING_TEST_API_URL` to
the default Edge runtime. The production-image smoke checks use only synthetic
settings, and the database compatibility check also loads booking fixtures.

## Validation

The one-page booking-only revision passes 15 booking UI tests, including section
transitions, multi-service selection, dependency resets, draft restoration,
unchanged-selection editing, details retention, inline errors, verification,
slot conflicts, retry recovery and Arabic RTL. No customer-account code, routes,
translations, migrations or backend changes are included in this revision.


`npm run check` passes: lint, Functions checks and 53 tests, 35 application tests,
41 operational tests, migration/domain checks and build. Production dependency
audit reports no vulnerabilities. Earlier booking-only migration/seed replay passed
140 database assertions on the pinned PostgreSQL image in a disposable container
without published ports or production data. The bootstrap reads schema only from
the owned local Test backend; Test-only account triggers are excluded as
application-owned objects, along with the pre-existing application triggers.

Browser-rendered visual acceptance remains pending because the browser runtime
reports local browser access disabled. Unit tests, database checks and a build
are not a substitute for screenshots. See `../design-qa.md`.

The frontend container smoke test passes. Local pinned Functions-image execution
was attempted but timed out on the pre-existing `admin-password-reset` worker,
before reaching the new booking worker. The normal Deno type/unit checks pass;
GitHub CI will run the Linux compatibility check after the dev push.
