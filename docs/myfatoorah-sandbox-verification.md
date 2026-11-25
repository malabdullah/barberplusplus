# MyFatoorah sandbox verification — 24 November 2026

Hosted Test only. Branch `codex/myfatoorah-sandbox`. Main, production, native
applications and provider selection remain unchanged.

| Scenario | Observed result |
| --- | --- |
| Private merchant key | V3 payment-methods API returned six enabled methods. |
| Discounted subscription with KNET | Three places, KD 30.000 less 50% = KD 15.000. Official sandbox card completed. Return was server-verified, one paid receipt issued, term ended 24 December 2026. |
| Extra place with Mastercard | Server quoted KD 10.000 within the just-started term. Official sandbox card and successful 3-D Secure simulation completed. Paid capacity increased from three to four; original term end stayed unchanged. |
| Declined card authentication | Sandbox 3-D Secure denial returned to Test. Subscription stayed not started, paid capacity stayed zero, no paid receipt issued. The invoice remains available for same-invoice retry. |
| Lost return URL | Check without a payment ID recovered the stored invoice status from MyFatoorah; declined outcome was verified. Handler coverage also verifies successful recovery. |
| Repeated payment check | Original paid invoice ID preserved; no second receipt or term. |
| Forged/foreign evidence | Handler rejects mismatched invoice, external identifier, amount, currency, payment ID and attempt. Hosted cross-business quote requests returned forbidden. |
| Invoice download | Downloaded the actual capacity invoice as a non-empty PDF. |
| Mobile and languages | 390px layout had no horizontal overflow in English or Arabic. Light/dark modes checked. Incorrect copied Arabic provider wording corrected. |
| Existing Test payment boundaries | Both new MyFatoorah and existing UPayments endpoints require the private gateway and authenticated staff session. |
| Fresh owner test | A separate synthetic manager/shop remains pristine, with no payment attempt, for interactive testing. Credentials remain private. |

Validation passed:

- Complete `npm run check`: 368 function tests, 569 frontend tests, 85 operations
  tests, lint/type/migration/domain checks and production bundle build.
- 11 Test gateway tests.
- 16 hosted database assertions, rolled back completely.
- Dedicated MyFatoorah component tests and hosted manual journeys above.

Existing bundle-size warnings remain. No real card, real charge, production
database access, native app deployment or production deployment was used.

This initial section verifies subscriptions/extra places. See the booking pilot
verification below and [the runbook](myfatoorah-sandbox.md) for the extended scope.

## Shop publishing follow-up — 25 November 2026

The owner's card sandbox shop was prepared as inactive. Its shop details,
services and Jassim's approved hours were complete, but publishing correctly
required an active shop. Corrected only that Test shop to active; it remains a
draft for the owner to publish. No subscription, payment or publication was made.

Publishing readiness now returns a list of safe reason codes for inactive shops,
missing name/location, invalid shop hours, missing active services, and missing
bookable barber setup. The website shows those requirements in English/Arabic
and retains the disabled publish button and existing server permissions. Older
responses retain the existing fallback message.

Verification: seven read-only hosted readiness scenarios passed, including the
complete owner shop. Full repository checks passed (368 Function tests, 571
frontend tests, 85 operational tests and build). The fixture correction is not
part of the migration; no fixture IDs or data changes are deployed with it.


## Booking payments — 25 November 2026

| Scenario | Observed result |
| --- | --- |
| Complete guest KNET journey | Selected the shop, Jassim, Haircut, 26 November at 12:00; entered synthetic email and no phone; paid KD 5.000 using the official KNET sandbox card; returned to a confirmed booking marked Paid online (Test). |
| Reload paid confirmation | Restored the same booking reference; no extra receipt. |
| Incorrect card number | MyFatoorah stayed on its card form; no payment or booking was created. |
| Mastercard/3DS denial | Returned to Barber++ with a retry message and Resume payment. Read-only database check confirmed no booking and no settlement receipt. |
| Mastercard retry | Resumed the same invoice, completed successful 3DS authentication, returned to a confirmed 12:30 Haircut booking marked Paid online (Test). |
| Actual financial records | Both KD 5.000 captures have exactly one confirmed booking and one settlement receipt each, using MyFatoorah source references. The synthetic shop rate is 5% (KD 0.250 commission and KD 4.750 shop amount per receipt). |
| Hosted transactional tests | Slot hold blocks other writers; no booking before payment; bad capability/amount/provider evidence rejected; repeated capture preserved one receipt. All test writes rolled back. |
| Manual approval / signed-in identity | Transactional SQL test proved request → staff approval → payment-due email → MyFatoorah checkout → confirmed paid booking. No charge before approval; wallet funds were not used. Synthetic accounts/sessions and schedule changes rolled back. |
| Late capture | Expired hold did not create a booking or receivable; marked for refund review. |
| Existing UPayments/B-Wallet | All 81 hosted regression assertions passed, rolled back. |
| Native boundaries | Existing native adapter retained, including when the website adapter is supplied. No native source or app build changed. |

The two actual successful sandbox bookings are retained for owner inspection.
They use synthetic guest names/emails only; no real money was charged. Refunds
are not automatically sent through MyFatoorah by this phase. Refund/reconciliation
review is explicit; no MyFatoorah payment is passed to the UPayments refund worker.

Final validation: complete repository checks passed with 380 Function tests,
572 frontend tests and 85 operational tests, plus lint/type/migration/domain
checks and build. The hosted approval suite also passed all combinations of
pay-at-shop/online/both and auto-confirm on/off, and refuses online payment for a
zero-price service. The owner shop's active/published state and Jassim's original
auto-confirm setting were preserved. The two confirmation emails were processed
by the existing Test mailbox capture flow. The misleading mobile-only guest
receipt wording was corrected in both languages. No production access, main/dev
merge, native code/build, real card or real payment was used.

## UPayments scenario parity — 25 November 2026

Adapted the UPayments subscription, extra-place, booking and B-Wallet scenarios
to the MyFatoorah sandbox. **Pass** below means the named checks passed, not that
all provider features are implemented. Database tests inject synthetic provider
facts; they do not charge a card. Handler tests mock provider responses. Only
rows marked **Browser** reached the real MyFatoorah sandbox.

| Area / scenario | Evidence and result |
| --- | --- |
| Monthly subscription, 50% discount, KNET | **Browser pass, 24 Nov:** KD 30.000 became KD 15.000; one paid invoice and three places. |
| Yearly quote and invalid frequencies/counts | **SQL pass:** canonical annual price; invalid frequency, zero, oversized and malformed capacity refused. |
| Discount eligibility | **SQL pass:** unknown, disabled, expired and monthly-only codes on yearly quotes refused; fixed discount uses exact fils; zero-total gateway charge refused. |
| Another manager's business | **SQL pass:** foreign reads do not expose an attempt and foreign writes fail. Missing/expired manager sessions refused. |
| Browser directly changing payment records | **SQL pass:** direct table writes/capture and anonymous execution denied. |
| Duplicate checkout clicks / requests | **SQL + handler pass:** repeated intent reuses the attempt; concurrent mocked starts issue one invoice; unresolved attempt prevents a second quote. This does not claim a real bank concurrency stress test. |
| Connection lost during invoice creation | **Handler pass:** no automatic second provider invoice after an uncertain response. |
| Provider rejects creation | **Handler pass:** no paid capacity or booking is issued. |
| Forged amount, currency, invoice, payment or external reference | **Handler + SQL pass:** mismatched evidence cannot fulfil payment. Browser return fields are not proof of payment. |
| Prorated extra place | **Browser pass, 24 Nov; expanded SQL pass:** card purchase applies paid capacity once. Half a monthly period quotes about KD 5.000 for one additional KD 10 place. |
| Fourth barber before/after payment | **SQL pass:** activation refused with three paid places; succeeds only after verified capacity becomes four. |
| Stale/tampered capacity quote | **SQL pass:** expired quote, changed amount and changed count refused. Subscription discount is not reused on the add-on. |
| Capacity receipt, term and renewal preference | **SQL pass:** replay keeps one add-on invoice; original term dates/renewal choice remain; no extra discount redemption. |
| Term changes during payment / term nearly over | **SQL + handler pass:** late stale capacity capture enters review without issuing capacity; near-expiry checkout refused. |
| Invoice PDF | **Browser pass, 24 Nov:** actual paid capacity PDF downloaded and non-empty. |
| Guest booking without phone | **Browser pass, 25 Nov:** synthetic email and no phone; KNET payment confirms the selected appointment. |
| Signed-in customer; approval before payment | **SQL pass:** request → staff approval → payment-due email job → checkout → paid confirmation. No provider checkout before approval. Real approval-email link was not repeated through the browser in this pass. |
| Pay at shop / online / both × auto-confirm on/off | **SQL pass:** all six combinations follow the configured method/approval rules. Online-only manual approval requires an authenticated customer. Zero-price service does not offer online checkout. |
| Wrong card details / 3DS decline / retry | **Browser pass, 25 Nov:** invalid card stayed on provider form; denied Mastercard authentication created no booking/receipt; retry of the same invoice succeeded. |
| KNET cancel and recheck | **Browser pass, this run:** returned with retry message and the same Resume payment URL. Rechecking preserved pending state; database confirmed no booking and zero settlement receipts. |
| Pending / authorized / cancelled transaction | **Handler pass:** `INPROGRESS`, `AUTHORIZE`, `CANCELED` cannot fulfil. A later successful transaction on the same invoice can fulfil once. |
| Inquiry timeout, HTTP error, malformed provider JSON | **Handler pass:** no capture and no new invoice. Sweep failure defers the next check. |
| Unopened invoice / lost browser return | **Handler pass:** pending stays unpaid; stored invoice can recover without browser payment ID. Successful paid confirmation reload was also checked in the earlier browser run. |
| Booking price, duration or policy tampering | **SQL pass:** submitted facts must match the server quote. Wrong shop and disabled payment gateway refused. |
| Slot holds and duplicate bookings | **SQL pass:** hold blocks a competing attempt and another booking writer; replay preserves one capture/receipt. |
| Shop/barber/service changes during payment | **SQL pass:** changed price/duration, disabled auto-confirm, inactive barber or paused shop cannot produce an invalid confirmed booking. |
| Late successful capture | **SQL pass:** expired hold produces no booking or shop receivable; payment enters refund review. |
| Paid booking cancellation | **SQL pass, safety boundary only:** MyFatoorah payment enters refund review; UPayments refund worker excludes it; no fabricated refund ledger entry. **Actual MyFatoorah refund remains missing.** |
| Settlement accounting and captured emails | **Browser + SQL pass:** each actual KD 5 payment has one receipt, KD 0.250 commission and KD 4.750 shop amount under this synthetic policy. Confirmation email jobs use Test capture. |
| Existing UPayments / B-Wallet regression | **Hosted SQL pass:** all 81 assertions still pass on a non-MyFatoorah Test pilot, including split funding, refunds, approvals and payment methods. This proves preservation, not MyFatoorah wallet support. |
| English/Arabic, mobile, light/dark | Earlier sandbox browser pass retained; cancellation-specific English/Arabic copy and retry control verified by frontend tests. This pass does not claim another full cross-device sweep. |
| Invalid JSON request | **Handler + hosted HTTP pass:** JSON `null` now returns HTTP 400 without a provider action. |

Three issues found and fixed on Test:

1. MyFatoorah reports a cancelled transaction as `CANCELED` while its invoice can
   remain `PENDING`. The adapter now offers same-invoice retry instead of a vague
   pending result. Subscription checkout also shows explicit cancellation copy.
   This follows [MyFatoorah's payment-status contract](https://docs.myfatoorah.com/docs/get-payment-details).
2. A SQL row alias conflicted with the sweep routine's PL/pgSQL record variable.
   The scoped Test migration separates those aliases; paid-cancellation review
   and background sweep selection now run successfully.
3. A JSON `null` subscription request produced a server error. It now returns
   the invalid-request response (400).

Coverage totals for this pass:

- 31 hosted subscription scenario groups, including the original 16 baseline
  assertions; 17 additional hosted booking scenario groups.
- Original 24 booking assertions plus approval/payment-method/late-capture suite
  rerun successfully. All SQL fixture writes rolled back.
- 53 focused MyFatoorah handler tests passed. Full repository checks passed:
  **406 Function tests, 573 frontend tests, 85 operations tests**, lint, types,
  migration names, domain checks and build. These totals overlap; do not add them.
- 81 existing UPayments/B-Wallet assertions passed separately.
- Actual KNET cancellation verified against the provider sandbox in an isolated
  Chrome Guest session; existing owner sessions preserved. No real card/charge.

### Scenarios that cannot yet pass as MyFatoorah features

| Remaining capability | Current safe behavior / next work |
| --- | --- |
| Full/partial gateway refunds and settlement reversal | Refund review only. Implement provider refund submission, ambiguous-result recovery, verified completion and one-time ledger reversal before claiming parity. |
| Signed MyFatoorah webhooks, duplicate/reordered webhook delivery | No MyFatoorah webhook fulfilment endpoint is enabled. Forged unsupported actions cannot fulfil. Configure signature validation and replay handling before testing actual callbacks. |
| B-Wallet top-up, wallet-only and split MyFatoorah funding | Refused/hidden on MyFatoorah checkout. Existing UPayments wallet scenarios remain available and unchanged. |
| Native checkout/return, native payment notification routes | Intentionally excluded; both native apps unchanged. |
| Automatic recurring provider debit | Not implemented. Renewal preference is not permission or evidence of an automatic debit. |

These are explicit gaps, not passing cases. MyFatoorah remains a Test integration
on `codex/myfatoorah-sandbox`; no dev/main merge, production deployment or native
app change is included.
