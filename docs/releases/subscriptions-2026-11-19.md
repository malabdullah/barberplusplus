# Subscription foundation release

The owner approved the connected manager Billing & Subscription screen and
separate Admin Subscriptions and Discount codes screens on 19 November 2026.
This release enables those protected routes in production. Design previews
remain Test-only. Unreleased Android changes are excluded.

Nine additive migrations create private business billing records, integer-fils
estimates, renewal preferences, dated access exceptions, billing transfers and
discount definitions/history. Existing shops are grouped by their current
manager, with 30-day transition status for currently published businesses.
The migration histories and schema fingerprint must be reconciled through the
reviewed backend release before frontend activation.

Payment gateway integration, actual charges/invoices, discount redemption and
booking/capacity enforcement are postponed. Access evaluation still reports
`enforced: false`; this release does not block existing customer or staff bookings.

The hosted Test receipt and 65 rollback SQL scenarios are documented in
`docs/subscription-foundation.md`. Release CI must validate the isolated source
and exact production images. Production verification is read-only, checking
the migration ledger, private privileges, invoker RPC, existing-shop adoption,
runtime commit and actual running image. No production QA accounts, discounts,
grants, payments or bookings are created.

Rollback preserves applied SQL and customer writes. The prior compatible
frontend/Functions artifact may be restored through the release controller.
Record the final commit, workflow, artifact and deployment evidence here after
verification; preparation alone is not deployment success.
