> **Versioned feature contract / historical phase record.** The original status,
> approval limits and verification results below belong to their stated phase.
> Read [the current handoff](handoff.md), [product/status inventory](../PRD.md)
> and source matching the target release before using these details. Earlier
> Test-only/pending wording is not today's deployment status or a new execution grant.

# Real subscription enforcement — Test phase

Owner scope: hosted Test only; payment gateway, main and production excluded.

The portable migration defaults enforcement OFF. A separate hosted-Test-only
activation enables it after contract checks. Existing transition/trial dates are
preserved; no paid entitlements are seeded. New business trials start once at
first publication. No scheduled cleanup, messages, charging or settlement API.

Enforcement covers new customer and staff bookings, publication and active
barber growth, including managed barbers, accepted invitations and My Chair.
Existing reservations, receipts, claims, sharing, history, cancellation and
rescheduling remain available. Reopening a terminal reservation or replacing
its customer/shop is treated as a new booking, not a reschedule.

Paid capacity is locked per billing business. Reductions give no current-term
refund. Reactivation within paid capacity is free. Increases beyond the paid
price require settlement; with the gateway postponed they remain blocked with
a prorated quote. Trial/transition/full access grants allow active team growth;
dated manual grants cover only selected shops. Administrative accounts have no
implicit subscription bypass. A not-yet-started business may prepare its team.

Booking channel comes from the verified database request role, never client
`added_by_type`: authenticated authorized staff writes are manual; the trusted
customer gateway, including a staff user's customer mode, is online. Customer
entry/search/catalog are filtered; a fresh write gate handles stale clients.

Verification: transactional synthetic SQL fixtures for access boundaries,
publication, paid growth, concurrency/atomicity, bypass attempts and preservation;
handler/unit tests; hosted UI and API checks; schema advisors and runtime pins.
Native compatibility is coordinated through Apps Manager before activation.
