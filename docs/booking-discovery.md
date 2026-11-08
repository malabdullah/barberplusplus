# Customer booking discovery

Three entry paths share the existing checkout:

- **Time first:** date and inclusive appointment start-time range → city → available barber (with shop) → services → exact start → checkout.
- **Barber first:** paginated barber search, optionally filtered by city → services → time → checkout.
- **Shop first:** city → paginated shop search → paginated barber search → services → time → checkout.

Times use Asia/Kuwait. The end of a search range limits the appointment's **start**, not its finish. Search means at least one assigned active service fits. The selected combination must fit a real slot; the exact-time query and final booking transaction recheck availability. No time is reserved by search. Changing the date/range never silently widens the search.

## Backend

The existing `customer-booking` Edge Function adds `discovery-filters`, `discovery-search` and `discovery-selection`. Public clients cannot directly call the discovery RPC or read private calendars. Optional account identity comes from a validated live bearer session; request-supplied identities are discarded. Public projections exclude contact details and schedules.

`public.customer_booking_discovery` is a service-role-only wrapper around a private implementation. Searches return at most 20 items plus an opaque filter-bound keyset cursor, ordered by favourites, name and ID. Only the selected barber's services are loaded. Legacy catalog clients remain compatible.

`private.booking_start_windows` is shared with the existing checkout and rescheduling slot calculation. It uses approved schedules, shop hours, breaks, inclusive vacations, booking horizons and active booking conflicts. It preserves the existing 15-minute grid anchored at the later opening. Existing final transaction locks, ownership, phone verification, idempotency and cancellation policies remain in force.

Partial and complete booking drafts retain the mode, date, range, choices and guest details through refresh and sign-in. Rebooking and favourite shortcuts can resume at their known provider. Self-booking is excluded both server-side and by the existing final booking protections.

## Validation

- `npm run check`
- `supabase/tests/031_booking_discovery.sql`: transaction-scoped fixtures; always rolls back.
- `npm run test:e2e:cloud -- booking-discovery.spec.js`
- `CLOUD_TEST_BROWSER=webkit npm run test:e2e:cloud -- booking-discovery.spec.js`

Hosted Test only: `qvkucvcjmojjbphlzlks`. Do not run load fixtures on production. Search indexes cover active/published shops by city, active barber order, English/Arabic substring search with `pg_trgm`, and active services. Existing indexed booking calendars are reused.

Measured on 2026-11-08: a 10,000-barber time query improved from 3,791 ms to 183 ms. A separate rolled-back 50,000-barber hotspot dataset with 2,000 occupied calendars measured 774 ms for time search, 116 ms for a specific name and 100 ms for an empty name result. The substring index was confirmed in EXPLAIN. These are warm database measurements on a synthetic workload, not a production latency guarantee. A separate hosted API test on the normal Test catalog made 30 requests at concurrency six: no failures, p50 475 ms, p95 679 ms. Full evidence is kept in the owner's Test artifacts.

Main and production require a separate approved promotion.
