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
