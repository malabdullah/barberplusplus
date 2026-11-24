# B-Wallet native Test contract

This contract is for Barber++ Test only. Its Supabase project is
`qvkucvcjmojjbphlzlks`. The app uses its existing approved Test API transport
and gate. Requests to `customer-booking` and `b-wallet` opt in with
`X-Barber-Native-Wallet: 1`. This is a compatibility marker. It does not replace
the gate or the current customer's Supabase access token. Do not send the
website marker, Test or Auth headers, or app credentials to the payment browser.

## Prices and payment choices

Money is integer KWD fils. Use integer or losslessly parsed decimal strings for
the returned fils and localized KWD with three decimal places for display.

`POST customer-booking` uses the existing booking selection shape
`{branchId, barberId, serviceIds, date}`, with the existing package fields when
applicable. `action: "slots"` returns the ordinary slot quote plus
`pay_at_shop`, `online_payment`, `wallet_payment`, and
`confirmation_required`. Pay at the shop uses the existing `book` action over
the same opted-in transport. A shop change can return
`SHOP_PAYMENT_CHANGED`, which requires reloading the available options.

Online payments in this first native version require a customer account.
If cash is available, guests can still use it. For online-only shops the guest
must sign in. Keep the selection during sign-in. A signed-in customer can choose
a valid B-Wallet amount and pay the rest via UPayments. Shop managers control the
type of payment and barbers control whether approval is required.

## Booking routes

Use the existing signed `account-proof` and selection validation. Build the
normal booking payload with date, Kuwait local time, expected duration and
price, the policy quote, language, and the verified proof.

| State or action | Test request |
| --- | --- |
| Auto-confirm on and pay online | `customer-booking` action `online-start`, the booking payload, a client-generated UUID `capability`, and integer `walletFils`. Send `0` for gateway-only. |
| Auto-confirm off and pay online | `online-request-approval` with the normal signed booking payload. Returns `attempt.state = approval_requested`. No payment or debit occurs until approval. |
| Approved, awaiting payment | `online-approval-checkout` with `{bookingId, capability, walletFils, language}`. The server validates ownership and the current payment deadline. |
| Check a payment, including a browser return | `online-check` with the same `capability` and the current account Bearer token. |
| Open appointment details | Supabase RPC `b_wallet_booking` with `{p_action:"view",p_id:bookingId,p_data:{}}`. Returns `state`, `payBy`, `totalFils`, and refund information for an owned appointment. |
| Cancel a paid booking | Existing `customer-auth` action `wallet-cancel`. Match the website payload and cancellation policy in `src/services/customerAuth.service.js`. |

Keep the UUID capability and pending action in secure, account-scoped storage
before opening checkout. On retry, reuse the same payload and capability. A
signed-in owner remains required for lookup. Scope pending tracking to backend
and account, and clear it on sign-out. Do not act on history owned by another
account. Never copy the capability into a URL or log.

Booking payment attempts include `id`, `state`, `totalFils`,
`externalFils`, `holdUntil`, `checkoutUrl`, `refundState` and
`accountSaved`. Handle `creating`, `pending`, `paid`, `failed`,
`expired`, and `review`; handle a pending retryable failure without creating
a duplicate. Use the verified paid result and receipt, rather than a browser
success page, to confirm. Approved appointments can await payment for up to
30 minutes, capped before the appointment. The online check enforces the actual
hold and the server can release an unpaid slot or refund a late capture.

## Wallet

- Test Supabase RPC `b_wallet` uses `{p_action:"status"|"summary",p_data:{}}`.
  For more history send the returned `nextBefore` as `p_data.before`.
- `POST b-wallet` with the opt-in marker and current account token uses
  `{action:"start",id:<new UUID>,amountFils:<1000..100000>,language:"en"|"ar"}`,
  `{action:"check",id}`, or `{action:"latest"}`. Reuse the UUID when a
  request is interrupted, including when the outcome is uncertain.
- Top-up states are `creating`, `pending`, `credited`, `failed`, and
  `review`. Credit the visual balance only after fetching the server summary.
- Wallet-only and split refunds, and gateway-only refund destination selection,
  use the existing website rules. A provider refund can remain pending.

## Return link and device checks

Open only an HTTPS checkout returned by the Test server, on exactly
`https://sandbox.upayments.com` with its sandbox `session_id` parameter.
Let the external browser follow provider-controlled navigation, including KNET
and Mastercard 3-D Secure. The provider returns to the public Test
`https://barber-open-test.alabdullah-cs.workers.dev/payments/provider-return`.
That endpoint discards query data and issues a fixed redirect to the canonical
verified app link `https://barber-open-test.alabdullah-cs.workers.dev/payments/return`.
The app claims only the canonical path with no query or fragment. The link
contains no payment ID, credential, outcome, or account information.

On app link, foreground, or cold start, recheck the pending attempt through the
authenticated Test API. Also support manual checking if the OS leaves the user
in the browser. The fallback offers **Open Barber++ Test app**, which opens a
neutral page on the separate Test website origin. Its **Open the Test app**
link gives the OS an explicit cross-origin tap to open the canonical app link.
No browser cookies are required for native verification.
Production clients and Test clients without the opt-in retain their existing
checkout behavior.

Use Test Fahaheel — Classic Cuts 01. Omar — Fahaheel 01 has been used for manual
approval with Classic haircut (KD 5.000). Set the Test shop mode deliberately for
each scenario and restore it after testing. Use only UPayments' published
sandbox cards. Verify available payment options, a cancelled browser checkout,
payment after approval, a cold-start return, exact final booking state,
wallet/split debits, and no duplicate submission on iOS and Android.
