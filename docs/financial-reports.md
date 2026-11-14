# Manager financial reports — Phase 2 (Test)

Managers open **Finances** in their workspace. Barbers retain personal operational
performance only. This phase records manual transactions; it does not implement
a payment gateway, card charges, transfers, tax filing or payroll.

## Contract

- Completed sales use the appointment date in Asia/Kuwait and saved booking price.
- Expenses are recognized on the entered incurred date; payment is recorded separately.
- Operating result = completed sales − non-void expenses incurred. It is before
  unrecorded costs and taxes and must not be advertised as audited net profit.
- Net customer receipts = recorded payments − refunds −/＋ corrections in the period.
- Net cash flow = net receipts − expense payments in the period, across all methods.
- Current customer due/refund due and unpaid expense balances cover **all dates**
  at snapshot generation. They are not historical closing balances for the selected period.
- Future deposits count as money received, not completed sales. Cancelled/no-show
  appointments owe zero in this version; prepaid money remains a refund due until
  a manager records the actual refund. Cancelling never returns money automatically.
- Existing appointments have no known payment history. Before using opening balances,
  managers must enter their historical payments/expenses. No payment is inferred from
  a completed status, including bookings that predate this feature.
- Partial payments/refunds are supported. Overpayments, refunds above net receipts,
  future transaction dates, and fractional fils are rejected. Currency is KWD only.
- Corrections retain original entries and require a reason. A paid expense must have
  its mistaken payments corrected before voiding. Corrections mean recording mistakes;
  a real customer refund must be recorded as a refund.

## Authorization and consistency

`public.manager_finances(text,jsonb)` is the only new authenticated endpoint.
It checks the live manager role, current session, suspension and current shop
ownership. Five private RLS tables deny direct access, including service-role access.
Shop locks serialize writes and ownership changes, booking locks serialize balance
checks against booking edits, and unique request IDs make identical retries safe.
Changing the payload under an already-used ID is rejected. Refunds/corrections
cannot make net receipts negative; expense payments cannot exceed incurred cost.
There are no Auth, booking, email or push side effects from a financial write.

Finance snapshots freeze rows in one SQL statement. A generated report and its
four-sheet Excel export use those same rows. Every page/download rechecks live
shop access. Transfers, revoked sessions and suspensions revoke access. Snapshots
expire after 24 hours. Report limits: one year, up to 500 shops, 30 requests/hour,
100,000 frozen detail/balance rows, 500-row export pages, 25-record UI pages.
Snapshots omit customer names, phone numbers, email addresses and booking notes.
Stable booking UUID references preserve financial history without preventing customer identity deletion. Shops with financial history cannot be deleted; pause them instead. Paid bookings cannot move to another shop; cancel/refund and create a new booking instead. Expired snapshots are cleaned hourly.

## Tables

- `private.shop_finance_expenses`: incurred amount/category/date, creator and void audit.
- `private.shop_finance_entries`: immutable receipt/refund/expense-payment/reversal,
  integer amount/signed fils, booking or expense reference, method/date/reason/creator.
- `private.shop_finance_requests`: idempotency request body/result.
- `private.shop_finance_runs`: selected scope, period, owner, expiry and frozen totals.
- `private.shop_finance_rows`: frozen paged export rows and current balances.

Future gateway integration must call the same balance/idempotency rules through a
separately authenticated server adapter, not write private tables from the browser.
Provider IDs/webhook reconciliation, vendor refunds, taxes, cash drawers, inventory,
commissions, scheduled reports and historical balance reconstruction are outside this phase.
