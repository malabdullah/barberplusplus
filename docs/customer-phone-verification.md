# Customer checkout phone verification

Phone verification applies to customer online checkout only, for guests and
signed-in customers. Manager, barber and admin authentication, staff booking
management and staff profile updates do not require an SMS code. Supabase remains
the source of Barber++ identity and roles; Google only verifies phone possession.

Guests verify their contact for each checkout. A signed-in customer with a
previously verified saved number can book again without another code. Changing
the saved phone number or country code invalidates that marker, even if the
customer later changes it back. An unverified customer can still sign in and
browse; verification is required before completing an online booking.

The production Google project is `barber-plus-plus-phone-prod`, separate from
`barber-plus-plus-phone-test`. Production uses reCAPTCHA and real SMS. Keep all
six supported GCC destinations allowed: Bahrain, Kuwait, Oman, Qatar, Saudi
Arabia and United Arab Emirates. Do not install fictional numbers, fixture codes
or Test bypass settings in production. The $10 monthly billing alert is an alert,
not a spending cap.

## Production acceptance and activation

On 5 November 2026 a diagnostic on the actual production domain completed a live
SMS send and code redemption. The recipient entered the code in the browser;
no code was put in chat. Its newly created Google verification identity and the
temporary diagnostic Worker/route were removed. No Barber++ account or booking
was created. Hosted Test also rejected incorrect codes and accepted its configured
fictional code. Test credentials and real delivery acceptance are separate checks.

Before activation, apply the reviewed migration
`20261104100356_customer_checkout_phone_verification.sql` transactionally after
checking the current migration ledger, pinned production database image and fresh
backup/restore receipt. It adds the private verification marker table, contact
change trigger, and a service-role-only RPC. Never replay the production baseline
or mark SQL applied without executing and verifying it. Rehearse on schema-only
metadata with synthetic data, then record the exact migration hash.

Deliver the reviewed frontend and Functions artifacts through dev and then main.
After the compatible code is healthy, configure the existing Functions runtime
with `CHECKOUT_GOOGLE_PROJECT`, `CHECKOUT_GOOGLE_API_KEY`,
`CHECKOUT_GOOGLE_APP_ID`, and `CHECKOUT_GOOGLE_PHONE_ENABLED=true`. Omit
`CHECKOUT_GOOGLE_TEST_PHONES` in production. Preserve all unrelated runtime values,
SMTP templates, secrets, native callbacks and pinned service images.

Verify that the live `phone-config` response names the production project and
has no fictional-number list, that guest bypass and account proofs for unverified
numbers fail closed, and that staff login still works without SMS. Complete a
customer browser check without placing an unapproved production booking.

For operational rollback, disable the explicit Functions switch and restore the
previous compatible Functions/frontend artifact if necessary. Retain marker rows
and customer writes; never reverse SQL or restore an old database automatically.
No native iOS changes are part of this release.
