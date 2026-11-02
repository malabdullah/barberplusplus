# Canonical customer profiles

`public.customers` is the only stored customer contact profile. It supports guest
customers and phone-optional registered customers. `private.customer_accounts`
contains only `user_id`, `customer_id` and `created_at`: a unique identity-to-profile
link. `private.customer_account_profiles` is a read-only computed view, not another
stored profile. Internal notes/tags live in `public.customer_staff_details` with
staff-only RLS and a customer foreign key. Staff editing uses the atomic, security
invoker `save_customer_profile` RPC and existing agent/admin authorization.

Bookings reference `customers.id`. Signed-in bookings resolve that ID from a
validated live session/account link. They do not create a phone-matched customer.
Guests can reuse a contact without overwriting it or acquiring its history.
Unverified profile edits cannot merge into an existing guest record just because
its phone matches. Account history still uses explicit booking ownership. Phone
changes retain the profile ID, booking links and ownership. Global uniqueness
across staff, customer and shop numbers is preserved; account links derive their
number from the canonical profile instead of storing another phone source.

Existing customer accounts and explicit booking ownership are migrated in one
transaction. Existing matching business contacts are consolidated without
assigning additional appointment ownership. No Auth rows are rewritten or
removed; the admin user's full Auth-row fingerprint must remain unchanged. The
owner permits disposable Test data cleanup, but this migration preserves accounts,
appointments and staff notes. Main and production remain separate.

## Web and iOS contract

Continue using the existing customer-auth/customer-booking Functions and action
payloads. Profile `id` remains the Auth/account ID for compatibility; new
`customerId` is the canonical customer ID. Do not substitute one for the other.
Do not query private account/link tables from clients. Do not use phone numbers
as persistent identity or history ownership. Profile updates change the shared
customer record, so staff and booking displays read the same contact immediately.
Login credentials/providers/verified login email remain managed by Supabase Auth;
confirmed customer login-email changes update the canonical contact email.
No admin credentials, role, identity or profile are part of this refactor.

This is a coordinated, incompatible schema change for future production delivery.
It needs its own reviewed release; it is not an automatic production promotion.

## Test verification

Hosted verification covers 131 account/social/email/phone/canonical-profile
assertions, 12 Chromium/WebKit customer and staff browser cases across both
languages and themes, and real gateway/API signup, confirmation, shared editing,
booking, duplicate-phone rejection, notes isolation and history after phone
changes. Every original account (88) and appointment (113) is preserved. No
admin login or admin write is used, and the admin Auth-row fingerprint remains
identical. The dedicated new API-test account and its cancelled appointment are
retained as synthetic fixtures. Test account link rows contain no contact copies.

The provider-status response still uses `{profile: {...}}`; it includes the
canonical `customerId` without changing the existing account `id`. The follow-up
response-contract migration is included in the same coordinated release.
