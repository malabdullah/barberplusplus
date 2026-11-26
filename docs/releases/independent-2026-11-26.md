# Independent Website release — 26 November 2026

Base: production/main `d5e3f1e`. Candidate branch: `codex/independent-release-20261126`.

Included: completion payment-method selection and 24-hour overdue staff reminders; recipient-scoped unread queries; clearer shop-publishing blockers; managed barber creation in setup; Google/Apple registration for new invited barbers; standalone branded subscription invoice PDF download.

Excluded: B-Wallet, UPayments, MyFatoorah, online checkout/payment-choice controls, gateway callbacks/refunds, native app changes, and Android activation/publishing. Existing Function source and all 168 applied production migration files are unchanged.

## Database review

Three pending migration bodies were previously verified on hosted Test. New release-only filenames append after the current Live ledger; existing Test history and original Test migration files remain unchanged on their branches. No Test database migration is replayed merely to rename history. The completion test now uses the existing settlement schema, with no wallet-specific column. Its 54 assertions passed in a rolled-back hosted Test transaction.

- `20261126035529_shop_publication_blockers.sql`
- `20261126035546_booking_completion_payments.sql`
- `20261126035547_completion_reminder_reschedule_race.sql`

The new tables are private with RLS enabled and client privileges revoked. Only scoped, live-session manager/barber completion is granted. The scheduler is private. Existing future appointments are queued; historical appointments are not mass-notified. No appointment is automatically completed. Existing invoice state/totals are used for PDFs; production invoices never display Test/no-real-payment claims.

## Verification / release gates

Local frontend suite: 107 files / 588 assertions passed. Function suite: 350 passed, lint and frozen type checks passed. Operational/build checks and GitHub exact-image/browser/database CI are pending. Hosted candidate UI and PDF checks are pending. Real Apple/Google authorization is not claimed by synthetic identity/unit checks.

Production remains unchanged until reviewed PR checks, current backup/controller verification and separately scoped operator access are satisfied. Migration application and release receipts must use the exact attested main artifact. Preserve the current Android activation and publishing holds.
