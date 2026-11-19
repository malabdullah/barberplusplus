# Subscription foundation — hosted Test

Implemented 19 November 2026. Payment gateway and production release are on hold.
This is the persistent foundation phase, not a finished payment or enforcement
system. The `/design/*` pages remain synthetic design previews.

## Review the connected screens

- Manager: `/dashboard/billing` (Billing in the manager menu).
- Admin / Super Admin: `/admin/subscriptions` and
  `/admin/subscriptions/discounts` (Subscriptions in the Admin menu).
- All routes are mounted only by the Test runtime. Existing Test login and Admin
  MFA still apply. No new credentials are required.

Manager prices and counts come from the server, not the calculator input.
Save a renewal preference, refresh, and check that it remains. Frequency changes
are scheduled for the next term, leaving the current one intact. No automatic
payment is possible. An estimate never consumes a discount.

An Admin can search/filter/page businesses, add dated full or selected-branch
manual access, revoke an exception with a reason, transfer billing to another
currently assigned manager, and create/pause/enable discount codes. Changes and
reasons persist. Discount history is readable without a mutation action. To test safely, use a synthetic Test business and a distinct
code. Revoking a grant retains its history and does not remove independent paid
access. A business with only one assigned manager cannot transfer billing yet.

## Data model

All records below are private and RLS-enabled with no direct client privileges.

| Table | Purpose |
| --- | --- |
| `private.billing_businesses` | Stable business identity and billing manager |
| `private.billing_shops` | Shops belonging to a business |
| `private.billing_subscriptions` | Trial, transition, paid-period fields, capacity, renewal preferences, revision |
| `private.billing_access_grants` | Dated, reasoned full/manual exceptions; revocation retains original row |
| `private.billing_discount_codes` | Immutable discount definition, eligible frequency, duration, deadline and total limit; enabled flag |
| `private.billing_invoices` | Future settled financial records; none are invented by this phase |
| `private.billing_redemptions` | Future settled-invoice usage, unique once per business/code |
| `private.billing_audit` | Actor, action, reason, timestamp and structured change details |
| `private.billing_requests` | Actor-scoped exact-retry results |

Migration adoption groups existing shops by their current manager. This is the
only existing relationship available in the app, so it does not guess companies
from names, emails or logos. Existing published businesses get 30-day transition
access on Test; no paid invoices or charges are created. New shops join an owned,
assigned business or an empty owned business. A former origin manager cannot add
new shops to billing transferred to someone else. Shop handover does not move
the historical business or reset its period.

The current app has one operational manager per shop. The foundation can group
shops with different operational managers after a handover and transfer billing
between those assigned managers. It does not introduce co-manager shop access or
an arbitrary business-merge tool. Other managers receive status, not invoices or
the billing manager's history. Historical identity FKs detach on normal account
deletion; request cache rows cascade. Existing account-deletion guards still own
whether account deletion is permitted.

## Rules implemented in the foundation

- Integer fils: monthly `max(25000, active_count * 10000)`, yearly ten monthly
  amounts. Minimum applies before discount, and total cannot fall below zero.
- Count active accepted account barbers, managed barbers and active My Chair;
  count linked identities once. Pending/inactive profiles do not count. Breaks,
  vacations and shop pause do not turn active capacity into free capacity.
- First active publication starts one 14-day trial. Re-publication cannot reset
  it. Trial expiry has no renewal grace.
- Access evaluation uses exact half-open timestamps. Paid access, trial and
  transition are independent of Admin exceptions. Failed paid renewal can have
  at most 72 hours from paid expiry when renewal remains requested. Voluntary
  nonrenewal does not get grace.
- Dated full and selected-shop manual grants require reason and ownership;
  invalid/foreign shops and invalid intervals are rejected. Ends-before dates
  mean midnight in Kuwait at the beginning of the displayed end date.
- Discount eligibility is monthly/yearly/both, percentage or fixed fils,
  first-payment or three monthly payments, optional global limit, once per
  business. Deadline includes the displayed Kuwait date. An expired/paused,
  ineligible or exhausted code is rejected. Estimates never reserve or redeem.
- One billing manager can save renewal intent and next frequency. Admin transfers
  require another live assigned manager. Periods and financial history stay with
  the business.
- Every write needs a UUID request ID. An identical retry has one result/audit;
  altered retries and stale renewal revisions are rejected.

## API and authorization

`public.subscription_billing(p_action text, p_data jsonb)` is a SECURITY INVOKER
wrapper. It calls one dispatcher in the unexposed `subscription_billing` schema;
the existing `private` schema remains inaccessible to authenticated clients.
The dispatcher checks the live Auth role, session, explicit revocation, current
shop ownership and Admin MFA. Client user metadata/price/count/actor IDs never
grant authority. Barbers, customers, anonymous and stale/revoked sessions fail.

Read actions: `businesses`, `detail`, `quote`, Admin-only `codes` and `code-history`. Lists are
bounded and paginated. Manager mutation: `preferences`. Admin mutations: `grant`,
`revoke-grant`, `transfer`, `create-code`, `toggle-code`. Unknown actions fail.
There is no settlement, fake-payment, refund or caller-supplied clock endpoint.
Server-side internal helpers accept timestamps solely for deterministic tests.

## Verification

- 65 hosted SQL scenarios passed, all fixture writes rolled back. They include
  actual authenticated-role RPC execution and privileged-role denial paths.
- All nine feature migrations replayed on hosted Test inside a single rollback
  transaction, then the same 65 scenarios passed. Existing app/Auth/Storage
  records were unchanged by that rehearsal.
- Nine new tables have RLS, revoked direct privileges and required indexes.
  Security advisors added only the expected private/no-policy informational
  notices, no new warning. The project's unrelated warnings are unchanged.
- Lint, 301 Deno checks, 498 frontend tests, 80 operations checks and frontend
  build passed. Operations mock sockets required an authorized sandbox rerun;
  no local website or database was started.
- Expected public schema includes the invoker wrapper and shop trigger. Full
  local Docker schema-drift execution is intentionally not used under the hosted
  Test-only instruction; hosted transactional replay covers these migrations.
- Native or exact production image compatibility is not claimed. Installed
  Node 24.9.0 remains below the repo's declared 24.20.0 minimum.

## Explicit next-phase boundaries

Access evaluation reports `enforced: false`. No publication, customer booking,
manual booking, barber activation or existing appointment is blocked by this
foundation. Existing shop pause/Admin suspension checks continue unchanged.

Gateway selection, secure settlement/reconciliation, real invoices and discount
consumption, prorated capacity purchases/approvals, renewal workers/retries,
reminders, refund handling, simulated-payment journey screens and actual booking
enforcement remain later phases. They must use these private records and an
atomic settlement transaction, not accept a browser's claimed payment. Do not
describe this foundation as all subscription phases implemented.

## Hosted browser verification and remaining review

The existing synthetic Manager's saved password was rejected once; it was not
retried or reset. The documented separate synthetic Manager signed in normally
and loaded its own real Billing record. The yearly minimum returned KD250.000
from the server. Calculator reads do not change renewal preferences or create
invoices. Original account settings and records were preserved.

The non-protected synthetic Admin signed in and reached mandatory MFA. No
verification or enrollment action was taken. The Admin browser visual pass is
therefore pending normal MFA; it is not described as passed. Admin authorization,
MFA, grants, transfer and discount behavior passed in rollback SQL; Admin date
form/history behavior passed component tests. The owner can review the connected
Admin screens after completing their normal Test sign-in and MFA.

Both temporary credential handoffs were deleted. No password/token was printed,
no account reset or new login account was created, and the protected Super Admin
was not used. Main, production, native apps and App Store submission were not
changed for this feature.
