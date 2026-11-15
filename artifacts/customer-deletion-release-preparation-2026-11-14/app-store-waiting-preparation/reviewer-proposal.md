# Reviewer identity and demo proposal — nothing looked up or provisioned

The owner's proposed address is **support@barberplusplus.com**. It is a candidate
app-account username, not authorization to inspect or repurpose the support inbox
or an existing user. Public source references that address as support/Reply-To;
that proves neither mailbox delivery/control today nor ordinary-customer eligibility.

## Proposed ordinary review access

Use this address only if a separately approved exact lookup proves it unused or
an explicitly reusable dedicated customer with no existing personal/work scope.
Never change the admin, staff role, support mailbox credentials or an existing
customer's data to make it eligible. If occupied/privileged, stop and ask the owner
for a distinct controlled review alias. Do not enumerate alternative addresses.
The app password must be distinct from Zoho credentials and stored/shared only in
the later approved private review-credential destination. No credential is created,
reset, sent to Apple or put in Git/chat by this proposal.

The reusable account can demonstrate account/history/favourites/settings using
only approved synthetic fixtures. Prefer reviewer-owned sign-up/inbox for a
destructive deletion exercise, so fresh email proof is practical and the reusable
login survives. Normal API also supports password proof where the actual account
has a password. Do not bypass proof, expose the support mailbox/Test inbox, share
the owner's personal session, fake confirmation, or silently recreate an account
Apple deleted. A separate sacrificial customer/cleanup cycle needs explicit scope.

## Actual public-source routes/API/demo references

| Source | Actual reference and implication |
| --- | --- |
| `src/App.jsx` | `/book`, `/customer/sign-in`, `/customer/sign-up`, `/customer/account`, `/customer/delete-account`, `/privacy`, public `/support`, `/booking/share` |
| `src/pages/CustomerAccount.jsx` | Profile links to `/customer/delete-account`; no special reviewer role/menu |
| `src/pages/CustomerDeleteAccount.jsx` | Fresh proof, explicit final cancellation/digest confirmation, saved pending/status recovery; not immediate delete on page load |
| `src/services/customerDeletion.service.js` | POST selected API `/functions/v1/customer-account-deletion`; validated customer token except opaque receipt-bound status/retry |
| `supabase/functions/customer-account-deletion/handler.ts` | Preview does not send mail; start/resend send proof, password authenticates, confirm is destructive, retry can schedule cleanup, Apple registration calls provider |
| `supabase/migrations/20261113131730_customer_account_deletion.sql:deletion_actor` | Live session, trusted customer role, linked-identity/work-ownership and scope guards; staff/barber/manager/admin/invitation responsibilities can deny deletion |
| `src/pages/ContactSupport.jsx`, `CustomerPrivacy.jsx` | Public support/privacy routes and mailto support address; no mailbox authentication or ticket delivery proof |
| `src/pages/Landing.jsx` | Explicitly illustrative demo date/rating/avatar; it is not an App Review backend fixture |
| `public/booking-demo/{seafront,market-street,city-centre}.png`, `src/pages/SharedBooking.jsx` | Demo image assets/allowed image path, not a demo-account route, auth bypass or proof of existing bookable shops |
| Native `docs/app-store/reviewer-access-plan.md`, `review-notes-draft.md` | Existing private-field/demo-scope proposal; Root owns final native notes and archive verification |

No dedicated App Review authentication bypass or review fixture provisioning API
was found in the scoped deletion/customer-auth/booking source review. Absence of
such an endpoint is not proof that a proposed address or demo record is absent
from production; no production lookup was made.

## Minimal later read-only eligibility scope to ask for

Approve the exact email and, separately, **one owner-selected demo shop ID/name**
with selected barber/service IDs. Do not run a broad account/shop list. A bounded
database-only window would return only booleans/counts for:

- Exact case-insensitive Auth match count; confirmation/enabled/password/provider
  availability indicators, canonical/linked customer counts and work-role/link
  conflict booleans. No IDs/emails/phone/password hashes/tokens/identity payloads,
  customer rows, session credentials, notes or bookings are exported.
- Whether existing role/manager/barber/admin/audit/invitation relationships would
  block normal customer deletion; do not call or relax those responsibilities.
- For the exact selected demo: synthetic/owner approval status, active/published
  eligibility, permitted barber-service/package linkage, approved hours/breaks/
  vacations, duration/price validity and availability/occupancy counts. Existing
  demo imagery does not imply fixture ownership or safe reuse.
- Actual checkout-policy mode and whether the intended signed-in review flow
  requires a verified supported phone. `customer_checkout_policy` can be
  `standard` or `email_only`; do not guess the deployed value. Under standard,
  any needed phone verification uses normal supported-country rules and a real
  separately approved recipient. Never seed a verified flag, share the owner's
  number, reuse a staff number, bypass uniqueness or incur an unapproved SMS.
  Guest email/optional-phone discovery is an alternative normal flow, not automatic
  account linkage or a workaround for demonstrating signed-in features.

This lookup does not create users, link accounts, verify email/phone, send mail,
start a login/password attempt, query a mailbox or grant reviewer access.
Eligibility failure returns a blocker for the owner, not a repair instruction.

## Provisioning/acceptance approval still needed after lookup

Freeze the exact allowed account/profile, one explicitly synthetic review shop/
barber/service set (or approved existing demo reuse), review-window availability,
any future/past appointments, allowed booking emails/push/SMS recipients, retention
and exact cleanup. Respect ordinary manager/shop/service/schedule rules and global
phone uniqueness; no actual charge/service obligation or unintended real-shop
appointments. Select dates at provisioning so review instructions will not expire.
Do not infer permission to create a manager, mark completion, rate or delete data.

Root must approve the actual private username/password destination and tested
review instructions before saving them in App Store Connect. Keep the owner’s
review-contact fields untouched. Final production deletion availability, public
policy/support URLs, safe demo flow and exact native archive must be verified
before review notes claim them. Upload/submission/public release are separate
owner decisions; all remain on hold.
