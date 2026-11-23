# UPayments subscription checkout on Barber++ Test

This pilot uses UPayments’ hosted KWD sandbox for a manager-initiated
subscription. It uses the existing Barber++ pricing function and writes its
verified receipts to subscription invoices. The webhook always verifies the
signature and obtains the payment status from UPayments. The browser redirect
only opens Billing and checks the previously stored attempt.

## Setup

- Deploy the UPayments migrations from `ops/cloud-test/migrations` to
  `qvkucvcjmojjbphlzlks` in order. They are exclusive to hosted Test.
- Set `UPAYMENTS_SANDBOX_TOKEN` and `UPAYMENTS_SANDBOX_HMAC` in that project's
  Edge secrets using the non-whitelabel values from the [UPayments sandbox
  documentation](https://developers.upayments.com/reference/test-environment-details).
- Deploy `upayments-subscription` with platform JWT verification disabled.
  The webhook verifies HMAC itself and the manager route requires the existing
  Test Worker gateway secret and staff JWT.
- Deploy the Worker and assets from this branch with the existing gate bindings.
- Enable the singleton `upayments_test.fixture` for a synthetic manager's own
  single draft shop and billing business. Optionally bind a dedicated one-use
  discount of less than 100%. Disable that row to hide the checkout. Leave the
  Function deployed until any open checkout has reached a verified result.

## Try a checkout

1. Sign in to hosted Test as the pilot manager and open **Billing & Subscription**.
2. Select monthly or yearly, enter barber places, and review the total. Three
   monthly places normally cost KD 30.000.
3. Choose **Pay with UPayments (Test)**. Select KNET or card and use the
   [official Test Cards](https://developers.upayments.com/reference/test-cards).
4. Return to Billing. Use **Check payment** if verification is pending. After
   verified capture, the receipt shows the paid places and period end date.

If the charge request loses its connection before the link can be saved, the
attempt stays in **Checking whether checkout opened**. Verify the outstanding
sandbox order before clearing it. The system never issues a second charge for
that intent automatically. Keep the normal simulator for other Test shops.

## Buy extra barber places during a paid term

1. Open **Billing & Subscription** and find **Add barber places** in the Test checkout.
2. Enter the total number of places you want after payment. With three paid
   places, enter four to add one, then select **Review additional places**.
3. The five-minute quote uses the difference in term prices for the time left in
   the current billing period. For example, a KD 10.000 full-month difference
   costs about KD 5.000 halfway through the term. Subscription discount codes
   apply to the subscription quote and the separate capacity charge uses the
   existing undiscounted proration rule.
4. Choose **Pay with UPayments (Test)**. After verification, the additional
   places appear in the current term. **Invoices** includes a separate
   prorated place-purchase PDF. Open **Manage barbers** to activate the barber.

Capacity is applied once, only after provider capture. The current billing
period and renewal preferences are preserved. A pending attempt keeps the
original checkout open. A stale quote must be reviewed again. Captures received
after the applicable term has changed are marked for review.

## Hosted verification on 22 November 2026

| Scenario | Result |
| --- | --- |
| KNET capture | Verified KD 22.500 after a 25% one-payment discount. Billing showed the receipt, three paid places and 22 December 2026 as the period end. The database recorded one invoice and one redemption. |
| Mastercard capture | Verified KD 30.000 through Mastercard’s 3-D Secure emulator. The signed webhook activated three paid places through 22 December before the manager reopened Billing. The mobile receipt matched the quote. |
| Declined card | UPayments returned `FAILED` with a non-terminal flag. The order stayed pending and the same provider session accepted the later successful test. |
| KNET cancellation | The provider returned `CANCELED` with a non-terminal flag. Checking payment showed the original attempt still pending, with zero invoices and zero paid places. A terminal failure releases the attempt for a fresh quote, as exercised by the automated handler test. |
| Repeated or unsigned callback | Two signed repeats returned 200 and the card business retained one invoice. An unsigned callback returned 401. |
| Manager authorization | The pilot stayed hidden for another synthetic manager. Reading the pilot returned no attempt and starting a charge returned 403. |
| Mobile | English quote and receipt checked at 390 px. Arabic quote and pay action checked in RTL at 375 px, with no checkout overflow. |

The first KNET capture exposed two sandbox response details. The real webhook
body did not match the documented example, and the status API returned an
internal session identifier after capture. The deployed handler now obtains the
order from the signed URL and looks up the original checkout session before
matching the provider order, amount and currency. The manager's **Check payment**
action recovered that first KNET receipt. The later Mastercard callback verified
the corrected automatic path.

Repository checks passed with 340 Edge tests, 551 frontend tests, 84 operations
tests and a successful build. Eight additional Test Worker checks passed. The
hosted Worker version is `107097b7-5881-4cdf-996a-d51fd7b215df` and the
UPayments Test Function is version 5.

## Prorated place purchase verification

An isolated draft shop started with three paid places, three active barbers
and a fourth inactive managed barber halfway through a synthetic monthly term.
The manager UI blocked the fourth activation and quoted **KD 4.999** for the
rest of the term. KNET sandbox capture matched the frozen quote. Barber++
increased capacity to four and issued one separate PDF invoice. The fourth
barber stayed inactive until the manager activated the profile successfully
through **Manage barbers**.

The database confirmed the exact proration, the original term dates and
renewal preferences, one invoice after a repeated capture, and no discount
redemption on the add-on. The original Test demo binding and billing state
were restored. The full checks passed with 342 Edge tests, 554 frontend tests,
84 operations tests and a successful build.

## Customer booking pilot

[Test Fahaheel — Classic Cuts 01](https://barber-test.alabdullah-cs.workers.dev/book?shop=b6110203-0000-4000-8000-000000000031)
is the enabled Test shop. Choose Omar — Fahaheel 01, Classic haircut
(KD 5.000) and an available time. In checkout, select **Pay online (Test)** and
**Continue to payment**. Use [UPayments' published KNET test card](https://developers.upayments.com/reference/test-cards)
and return in the same browser tab. The confirmation shows **Paid online (Test)**
after the server verifies capture. Reloading the confirmation in that tab
keeps the receipt, including when another tab starts a booking. The Test
Worker removes provider query fields from the return URL.

For a negative KNET check, first enter a short card number and verify the
gateway rejects it inline. Then use the published number with a non-matching
future expiry such as 09/31 and confirm. When UPayments returns a processed,
retryable failure, Barber++ shows a retry message and offers **Resume payment**.
The temporary hold protects the slot until retry, terminal failure or expiry.

The default is **Pay at the shop**. Online payment requires auto-confirmation,
a positive server quote, an eligible future slot and an enabled settlement
policy. The pilot retains a slot for seven minutes and the payment link has
a five-minute expiry. A failed payment or expired hold releases the slot.
A delayed capture that cannot confirm the appointment triggers a refund request.

The booking and one settlement receipt commit together after verified capture.
The receipt uses a distinct UPayments booking reference, starts without a known
gateway fee or bank settlement and uses the shop's configured commission terms.
Cancelling the paid booking requests one full sandbox refund. The settlement
ledger posts the refund after UPayments confirms it. An ambiguous refund
submission goes to review and is never repeated automatically.

The migration under `ops/cloud-test/migrations` is exclusive to hosted Test.
`customer-booking` enables the gateway only for the exact Test project, site and
credentials. Reads and starts through the website use the existing Test gate.
The webhook authenticates the signed payload and verifies the actual provider
transaction. The scheduler uses its own Test vault secret. The hosted pilot
shop is enabled through `upayments_test.booking_fixture` and uses a synthetic
zero-commission, platform-fee policy.
