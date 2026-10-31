# Customer booking on dev and hosted Test

Open https://barber-test.alabdullah-cs.workers.dev/book. Hosted Test is the default;
use localhost only on explicit owner request. Customer booking and email accounts
are approved for dev. A dev push runs validation; application changes also require
deployment and verification on hosted Test as described in `cloud-test.md`.

The booking journey stays on one page with six guided sections: city, shop, barber, services, date/time, then details and confirmation. Completed sections collapse into editable summaries and the next section opens. Service selection remains open until Continue is selected. Changing earlier selections clears dependent choices; booking drafts restore recent appointment selections without storing personal details or credentials.

Guests enter a name, valid GCC phone and optional notes, then confirm directly without a phone code. Signed-in customers use saved details. A customer without a phone enters it before confirmation; it is saved as unverified contact information and reused later. Authentication and email recovery are described in `customer-accounts-test.md`.

The gateway issues a signed details proof, calculates prices and durations from the database, validates availability and retries uncertain submissions idempotently. An atomic private ownership mapping ties signed-in bookings to accounts. Shared phone numbers do not claim other accounts or appointment history. Slot conflicts reopen availability while retaining details.

The receipt shows a reference and calendar download. Payment is at the shop. Customers and other non-admin interfaces use shop/صالون wording; schema/API identifiers stay unchanged.

## Boundaries and verification

Hosted customer routes use the separate Test backend, website access gate and
authenticated Function gateway. Google and Apple use dedicated Test registrations.
Emails stay in the private hosted Test inbox, and no SMS or paid integration is
enabled. Local Test retains its loopback restrictions when explicitly requested.
Preserve existing Test data; do not reset the stack for verification.

Maintained checks, database authorization tests, schema comparison and
email/guest/social gateway probes pass. Hosted browser checks cover staff roles,
mobile Arabic/light layouts, guest booking and customer email confirmation.
Real Google and Apple login passed, including Apple's missing-name completion
and persistence after reload. The owner tested and accepted the hosted customer
journey on 2026-10-31. These results do not authorize a production release or
establish managed-service version parity with the self-hosted production stack.
