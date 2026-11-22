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
