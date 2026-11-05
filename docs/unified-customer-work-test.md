# One account, customer and work modes (hosted Test)

Managers and barbers use their existing Auth identity for personal bookings.
Customer mode is navigation, never a role change. Manager My Chair remains the
optional work feature. Admin and agent accounts are not enrolled or modified.

Both interfaces share one browser Auth client, session and local sign-out.
Existing customer-only browser sessions are migrated. If an older browser had
two different signed-in identities, the active work session is retained and a
notice explains how to use the other account. No accounts, bookings or favourites
are merged or deleted based on names, emails or phone matches.

The canonical `customers` row is linked to the same staff Auth UUID through
`private.customer_accounts`. Existing work contact fields are compatibility
mirrors updated transactionally; a number belongs to the same person across the
linked records. A different person or shop still receives PHONE_IN_USE. Updating
the number clears checkout verification. Work access itself does not require SMS;
personal checkout follows the same verification rules as every customer.

The database rejects bookings where the customer account and assigned barber
share an Auth UUID, including manager chairs and direct staff writes. Personal
history, favourites, reviews, booking actions and activity use explicit ownership.
A personal booking in another shop grants no work access to that shop.

## Review on hosted Test

1. Sign in using the existing Test manager account. Open **Customer mode** in the
   header, or the mobile sidebar. The account page shows the same person's details.
2. Choose **Book appointment**, select another barber and complete the normal
   fictional-number verification. The booking appears under personal appointments.
3. Choose **Work mode**. The manager dashboard and My Chair remain available.
4. Repeat with a Test barber. Their own barber entry is excluded from selection.
   A selection made before sign-in is cleared if it points to that same person.
5. Change the personal phone/name; confirm the work account contact reflects it.
   A phone belonging to a different user or shop must be rejected.
6. Sign out in either mode. Both interfaces lose access in that browser session;
   other device sessions remain active. A customer-only account has no work switch.

## Validation

- `npm run check`: lint, Functions type checks, 94 Functions tests, 161 application
  tests, 61 operational tests, migration/domain checks and production build.
- Hosted Test pgTAP suites 006–023, with 37 new assertions covering shared identity,
  contact synchronisation, uniqueness, SMS markers, self-booking, ownership,
  role/tenant isolation, personal activity, expiry and suspension. Test fixture
  writes roll back. Existing role-guard tests now reflect the approved staff
  customer persona while continuing to reject forged/legacy registration.
- Live Test Functions accept both synthetic staff logins for customer APIs without
  changing their roles. Separate-session logout and work access were checked.
- Protected admin Auth-row fingerprints match the pre-change snapshot.

Production, main and native iOS code are unchanged. This feature is awaiting
owner review on hosted Test.
