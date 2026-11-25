# Booking completion payments and overdue reminders

Hosted Test only, 25 November 2026. Branch
`codex/booking-completion-payments-test`. The branch preserves the existing
MyFatoorah Test pilot; its completion/reminder commits are separate from that
gateway work. No dev/main merge, production access or native changes.

## Behavior

- Every website manager/barber completion action opens the same dialog, including
  the barber dashboard shortcut and manager My Chair bookings.
- Choices: Cash, Card (KNET / credit card), Bank transfer, Other, Not paid yet.
  The remaining balance is displayed before confirmation.
- Choosing a received method records the remaining amount in the existing shop
  finance ledger in the same transaction as completion. Partial payments are
  deducted; a changed balance requires another review. Unpaid completion leaves
  the amount due. Already-recorded/verified-online payments create no duplicate
  receipt and cannot be relabelled as cash. Free appointments need no receipt.
- Barbers can record completion payments only for their assigned appointments;
  they gain no access to shop finance screens, refunds or corrections. Managers
  retain their existing shop scope. Saved methods appear in booking details.
- A confirmed appointment still unchanged 24 hours after its scheduled end gets
  one dashboard reminder for the current manager and assigned account barber.
  Managed barbers route only to the manager. Existing notification preferences
  apply. No customer email/push or automatic completion is added.
- The scheduler runs every 15 minutes: delivery can be up to 15 minutes after
  the threshold. Rescheduling moves the reminder; cancellation/completion removes
  the queued reminder. Repeated runs do not duplicate it.
- Newly confirmed/changed appointments and existing upcoming appointments join
  the queue. Installation does not send a mass alert for historical bookings.

## Verification

| Check | Result |
| --- | --- |
| Hosted transactional database matrix | 54 passed; disposable accounts/data rolled back. All five methods, duplicate requests, partial/full payments, stale balance, verified online state, free appointments, ownership/session denial, future/pending/cancelled denial and direct-update bypass covered. |
| Reminder matrix | Before/after 24 hours, manager + barber routing, managed barber routing, preference opt-out, cancellation, rescheduling and duplicate runs passed. Booking status remains Confirmed. |
| Actual manager browser flow | Synthetic Test manager completed a KD 5 appointment as Cash. Details showed Cash; Finances showed KD 5 paid and KD 0 due. |
| Actual barber browser flow | Related Test barber completed a second KD 5 appointment as Card. Details showed Card (KNET / credit card). No finance access granted. |
| Responsive / languages / themes | English/light desktop and Arabic/dark desktop checked. Arabic/dark completion sheet checked at 390 × 844 and 320 × 568 using Chrome's responsive controls; methods and actions remained visible. Theme/language restored. |
| Notification display follow-up | Browser exposed HTTP 500 on the existing unscoped unread-count query. Reads/counts now explicitly filter the signed-in recipient, retaining RLS and preference filtering. After redeployment, the barber menu displayed the overdue QA alerts and tapping one opened the correct Confirmed appointment. |
| Full repository checks | 406 Function tests, 580 frontend tests, 85 operations tests; lint, types, domain and migration-name checks and build passed. Existing bundle-size warnings remain. |

The three retained browser fixtures are labelled `Completion QA` under
**Test Sharq — Classic Cuts 01**, assigned to **Omar — Sharq 01**, dated
23 November 2026. Two are completed (cash/card); the third remains Confirmed
for owner review. These contain synthetic contact details and no real payments.
Private staff credentials remain outside Git. Existing owner browser sessions,
barber availability, payment settings and account passwords were preserved.

The private tables deliberately deny direct client access. The authenticated
completion RPC is a scoped security-definer boundary with live-session and
relational ownership checks; the scheduler is not client callable. Advisor
notices for those deliberate patterns were reviewed, not treated as a claim
that all pre-existing project advisor warnings are clear.

## Deployment

Test migrations:

- `20261125085705_booking_completion_payments.sql`
- `20261125090241_completion_reminder_reschedule_race.sql`

Verified application source: `d533cca0d433692d43faf738777f931e0fe04c86`.
Hosted Worker version: `a5d0b50c-9b05-4c4f-b985-d99927834d41`.
The runtime configuration returned that source and the separate Test project.

The first build verification exposed overlapping validation/packaging builds
overwriting the injected Test runtime file. All checks finished before the
replacement cloud build/deployment; verify the hosted runtime release and Test
project after deployment. Do not run packaging and a plain Vite build together.

Production promotion requires separate owner approval and a candidate excluding
unapproved gateway work. Existing native customer applications are unchanged.
