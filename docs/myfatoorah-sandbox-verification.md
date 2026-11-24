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

This verifies the initial subscription/extra-place sandbox integration. Booking
payments, wallet funding, refunds and configured webhooks for MyFatoorah are not
implemented by this phase. See [the runbook](myfatoorah-sandbox.md).
