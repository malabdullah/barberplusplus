# Customer booking on dev and local Test

Open `http://localhost:5173/book` in the owned local Test checkout. Customer booking and email accounts are now approved for dev. A dev push runs validation only; it does not change the live website.

The booking journey stays on one page with six guided sections: city, shop, barber, services, date/time, then details and confirmation. Completed sections collapse into editable summaries and the next section opens. Service selection remains open until Continue is selected. Changing earlier selections clears dependent choices; booking drafts restore recent appointment selections without storing personal details or credentials.

Guests enter a name, valid GCC phone and optional notes, then confirm directly without a phone code. Signed-in customers use saved details. A customer without a phone enters it before confirmation; it is saved as unverified contact information and reused later. Authentication and email recovery are described in `customer-accounts-test.md`.

The gateway issues a signed details proof, calculates prices and durations from the database, validates availability and retries uncertain submissions idempotently. An atomic private ownership mapping ties signed-in bookings to accounts. Shared phone numbers do not claim other accounts or appointment history. Slot conflicts reopen availability while retaining details.

The receipt shows a reference and calendar download. Payment is at the shop. Customers and other non-admin interfaces use shop/صالون wording; schema/API identifiers stay unchanged.

## Boundaries and verification

Customer routes and gateways remain Test-gated and restricted to loopback backend/frontend URLs. Google/Apple are disabled pending Test credentials. Emails stay in the local mail catcher, and no SMS or paid integration is enabled. Preserve existing Test data; do not reset the stack for verification.

Maintained checks, database authorization tests, schema comparison and local email/guest/social gateway probes pass. Browser QA verified signup/email confirmation, sign-in, missing-phone validation, saving contact details during booking, receipt/history, recovery form and persistence after the user changed the password and signed in again. Desktop/Arabic visual acceptance and real provider consent remain pending. Exact production-image compatibility is a separate future release requirement.
