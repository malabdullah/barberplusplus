# Subscription Billing — design preview

Owner selected displayed Product Design option 1 on 19 November 2026.
This is phase 1 screen review, not subscription enforcement or payment collection.

## Review

Hosted Test: `/design/billing`, behind the existing Test access gate. Test manager
navigation also links to the preview. The route and navigation entry are absent
when the runtime environment is production.

The preview uses six synthetic active barbers, a KD60 monthly subscription and
sample September–November invoices. Paid access runs through 1 December 2026.
The permanent design-preview label identifies this data. It does not load a
business's real subscription or represent real charges.

Supported interactions:

- Expand barber usage; invited, managed and active My Chair profiles count alike.
- Review monthly/yearly pricing: KD60/month or KD600/year, saving KD120 annually.
- Schedule and undo a preview frequency change for the next renewal.
- Preview cancelling/resuming renewal while keeping the paid access deadline.
- Open and download an explicitly non-accounting sample invoice.
- Toggle the preview's language and theme without changing account preferences.
- Use responsive navigation and keyboard-accessible dialogs.

All subscription state is in React memory and resets on reload. There are no
billing requests, payment integrations, database mutations, real emails, or
financial documents. Links outside the preview use existing application routes.

## Next design work

Apply the selected visual direction to the calculator, paid-capacity approvals,
payment-review screen and Admin subscription controls. Do not present this screen
as completion of those designs or of the backend subscription phases.

## Later implementation gates

1. Approve the remaining screens.
2. Build business-level ownership, server-calculated pricing, dated access,
   invoice history, discount eligibility, paid barber capacity and permissions
   on hosted Test, with simulated payments clearly separated from real ones.
3. Verify lifecycle rules, cross-business isolation, concurrency, rounding,
   Arabic, themes, keyboard navigation and small-screen layouts.
4. Select/connect the gateway and test reconciliation, renewals and refunds.
5. Obtain separate approval before any production enforcement or release.

The payment gateway remains postponed. Main and production remain unchanged.

## Calculator and Admin expansion — 19 November 2026

Additional Test-only design routes:

- `/design/calculator`: active-barber estimate, monthly/yearly prices, minimum,
  yearly savings, discount eligibility/duration, renewal amount and review.
- `/design/subscriptions`: searchable/filterable/paginated synthetic businesses.
- `/design/subscriptions/:businessId`: dated complimentary/manual-only access,
  selected branches, billing-manager transfer and in-memory audit history.
- `/design/discounts`: create/pause/enable preview codes and inspect their history.

A shared in-memory context carries language/theme and preview code/business
changes between these pages. It never writes preferences or financial/account
records. Reload restores fixtures. The manager fixture is Nasser; transferring
Atlas billing responsibility makes his sample Billing view read-only and hides
its invoice controls. This illustrates future permissions; it is not backend
role enforcement. All preview pages remain behind the Test environment gate.

Calculator prices use integer fils, then apply the approved monthly minimum
before discounts. The numeric input is bounded at 10,000 barbers solely for the
preview; this is not a proposed production subscription-capacity restriction.
Codes are never consumed by estimates. Monthly three-payment offers stay monthly;
annual offers are explicitly annual and first-payment only. Codes are applied
one at a time. Manual-access grants require a selected branch and dated grants
require a reason. Separate paid access survives removing a complimentary grant.

Actual gateway integration, transaction handling, subscriptions/discount records,
server authorization, expiry jobs, notices and enforcement remain unimplemented.
No real grant, permission transfer, message, payment or refund occurs.


## Persistent foundation phase

The design-only limitations above remain true for `/design/*`. The subsequent
persistent Test foundation is available at `/dashboard/billing` and
`/admin/subscriptions`; see [foundation scope and verification](subscription-foundation.md).
It calculates real Test team counts and stores preferences/Admin changes. Gateway
collection, settlement and booking enforcement remain off. Do not confuse the
synthetic design screens with these authenticated, persistent screens.
