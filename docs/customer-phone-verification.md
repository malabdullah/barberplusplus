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

The web challenge has no application deadline while a customer completes
Google's security check. Firebase still bounds its network requests. Canceling
or leaving checkout resets the widget, rejects the pending operation, and
prevents a late CAPTCHA token from starting an SMS request. The code-entry
session is retained when Google accepts a request after a longer challenge.
The standard web flow uses invisible reCAPTCHA; Google can still require an
interactive challenge. Never use the fictional-number testing bypass in
production.

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

## Temporary email-only checkout policy

The service-only `configure_customer_checkout_policy('email_only')` switch pauses
customer checkout SMS independently of the retained `CHECKOUT_GOOGLE_*` provider
settings. The migration defaults to `standard` and activates no environment.
Use `configure_customer_checkout_policy('standard')` to restore the existing
signed-in phone requirement. The existing email-first guest path still accepts
optional, unverified phones under `standard`; this switch does not introduce
global guest SMS enforcement. Requiring SMS for email-first guests later needs
a separate explicit policy change that preserves their email contact and claims.
No provider secret, Google configuration or existing verification marker is removed
or fabricated. Staff authentication and manual booking rules do not change.

POST `customer-booking` with `{ "action": "phone-config" }` advertises:

```json
{"phone":null,"checkoutPolicy":"email_only","phoneVerificationRequired":false,"phoneRequired":false,"emailRequired":true,"guestContactMode":"email"}
```

Clients must recognise the explicit `email_only` policy. Missing/unknown fields
must retain their older behavior; a null provider configuration alone does not
mean phone-optional checkout. The database and Function read the authoritative
policy for each new booking/proof; lookup failure fails closed.

Signed-in clients continue to request `account-proof` with a live Auth token.
The proof uses the canonical account's verified Auth email and saved optional
phone, binds the account/session and explicitly sets `phone_verified:false`.
A missing verified account email returns HTTP 428 `EMAIL_REQUIRED`. Clients cannot
supply an email to override this identity. They may save an optional phone through
the normal profile update before requesting the proof; global uniqueness and
verification-marker invalidation remain enforced.

New guests request `guest-proof` with `contactMode:"email"`, name, email,
countryCode (default `+965`), optional phone (empty or omitted), and language.
The email is contact-only: no OTP, lookup, automatic linking or profile overwrite.
New phone-only guest-proof requests while paused return HTTP 428 `EMAIL_REQUIRED`.
Malformed contacts return `INVALID_DETAILS`; guest rate limits remain active.

Existing signed phone-only attempts and receipts are not converted into email
attempts. Their IDs, closure, price/package checks, recovery window and original
claim semantics stay intact. New email receipt claims require explicit receipt
possession, its original one-hour deadline and a matching verified signed-in
email; canonical profiles are referenced rather than overwritten. Restoring
`standard` rejects new unverified account booking proofs again. Test email capture
and native push capture settings remain unchanged; no real messaging is needed
to test this policy.
