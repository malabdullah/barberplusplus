# Shop settlements

The ledger supports Admin and Super Admin operations and manager access on the website.
Bank transfers are performed outside Barber++ and their outcomes are recorded in Settlements.

Settlements tracks booking money collected by Barber++, separately from the
shop's own Finances and the platform's Billing & Subscription records. Existing
appointments, cash receipts and subscriptions are not backfilled into this ledger.

## Workflow

1. Admin or Super Admin explicitly sets the default commission, or a shop
   override, and the shop's processing-fee agreement. The initial default is
   unset; the existing general-settings percentage is not imported.
2. Admin verifies the shop's bank beneficiary, saving its bank reference and
   masked IBAN suffix. Full bank details remain with the bank.
3. Admin records a verified external receipt against its booking. Rates and fee
   agreements are snapshotted as of the collection timestamp. A blank fee means
   unknown, not zero. Fees and settled funds can be confirmed later.
4. Only completed, ended appointments with settled funds, known fees and no hold
   enter a monthly statement. Unassigned earlier eligible receipts carry forward.
   Admin reviews the draft, then finalizes its fingerprint. A changed draft must
   be discarded and prepared again.
5. Admin prepares a full or partial transfer. This reserves money without sending
   it. After the actual bank transfer, Admin records the exact amount, reference
   and time. An unknown bank outcome keeps the money reserved until success or
   failure is confirmed; it cannot simply be cancelled and paid twice.
6. Managers can read final statements, receipt transactions, transfer status and
   download Excel for their currently managed shops. They cannot edit platform
   money, policies or bank details. Internal Admin reasons and bank beneficiary
   references are hidden.

Refunds reverse commission proportionally using cumulative integer-fils
rounding. Refunds after payout become negative balances recovered from future
shop earnings before another transfer. Subscriptions are never offset. Statement
original totals remain frozen; current adjustments and settled amounts are shown
separately. A settled amount may include refund recovery; the Transfers list
shows actual bank-transfer amounts.

Corrections append inverse journal entries; they never overwrite money history.
Receipt facts, policy versions, finalized statements and confirmed transfers
reject updates/deletion. Shops with settlement history cannot be deleted, and
captured bookings cannot be reassigned to another shop. An ownership transfer
revokes the old manager's reads and does not change the verified beneficiary.
The ledger stores no customer contact details and has no identity foreign keys
that would prevent normal customer-account deletion.

## Implementation

- Private `settlement_*` tables, balanced journals/entries, allocations, immutable
  statement snapshots, idempotent requests and audit history.
- `public.platform_settlements(text,jsonb)` and
  `public.shop_settlements(text,jsonb)` are invoker wrappers. The guarded definer
  dispatcher is in the dedicated, non-exposed `settlement_api` schema. Clients
  receive no USAGE on the existing private schema or direct ledger privileges.
- Every call rechecks live role/session/MFA and current ownership. Writes lock the
  shop, and repeated request IDs return the same result or reject changed input.
- All money is integer fils. List pages contain 25 records; Excel streams 500-row
  batches in a worker and rechecks access before releasing the file.
- `private.settlement_runtime` defaults disabled on a fresh install. Enable it
  through the reviewed release once the four ledger migrations and permissions
  have been verified. The booking payment gateway is postponed.

## Verification

The 75-scenario SQL suite in `supabase/tests/066_shop_settlements.sql` passed both
transactional migration replay and the installed hosted Test schema. All suite
fixtures roll back. It covers calculations, commission/fee snapshots, eligibility,
partial transfers, reservation/retry safety, uncertain outcomes, refund recovery,
rounding, immutable history, live permissions, manager transfer and separation
from shop finances/subscriptions.

Local focused tests cover the UI, exact money input, safe bilingual Excel and
export authorization. Hosted browser/API evidence and deployment pins are recorded
in this feature's dated artifact report after verification; source changes alone
are not a completed hosted deployment.
