# UPayments subscription checkout on Barber++ Test

This pilot uses UPayments’ hosted KWD sandbox for a manager-initiated
subscription. It uses the existing Barber++ pricing function and writes its
verified receipts to subscription invoices. The webhook always verifies the
signature and obtains the payment status from UPayments. The browser redirect
only opens Billing and checks the previously stored attempt.

## Setup

- Deploy the two gateway migrations from `ops/cloud-test/migrations` to
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
