# MyFatoorah sandbox

Dedicated branch: `codex/myfatoorah-sandbox`. Hosted Test only:
`https://barber-test.alabdullah-cs.workers.dev`, Supabase `qvkucvcjmojjbphlzlks`.
The branch preserves the existing B-Wallet/UPayments Test baseline. It does not
select a production provider or change either native app.

## Implemented scope

Allowlisted synthetic managers see **MyFatoorah checkout** in **Billing &
Subscription**. They can buy a monthly/yearly subscription or additional places
within an active term, using MyFatoorah's hosted KNET or card checkout. Pricing,
proration, discount validation, billing invoices and capacity use the existing
Barber++ financial rules. The pilot discount `MYFTEST50` reduces one monthly
subscription payment by 50% and is restricted to the dedicated fixtures.

The integration also supports website booking payments at the allowlisted
MyFatoorah Test shop: hosted KNET/card checkout, automatic confirmation after
verified payment, and payment after staff approval. B-Wallet funding/split
payments, MyFatoorah refunds, webhook configuration and production activation
remain separate work. Their existing UPayments Test flows
remain available on the preserved baseline. No MyFatoorah recurring charge is
enabled by a saved renewal preference.

## Payment integrity

- Only `https://apitest.myfatoorah.com/v3/` is used. Hosted checkout destinations
  must have the exact `https://demo.myfatoorah.com` origin and no URL credentials.
- Server-priced, manager-bound quotes and request IDs prevent amount edits and
  duplicate starts. Each attempt has a durable creation claim and provider
  idempotency key. An uncertain creation is held rather than blindly retried.
- MyFatoorah attempts and quotes live in the separate `myfatoorah_test` schema.
  UPayments attempts are never reinterpreted as MyFatoorah payments.
- A browser return is only a hint. The server fetches the payment and verifies
  invoice ID, external identifier, KWD amount, successful transaction and paid
  invoice before fulfilling anything. Repeated checks create no extra receipt.
- **Check payment** can recover via the stored invoice when the return URL is
  lost. Failed card attempts stay pending for retry on the same invoice. A
  verified terminal invoice may release the pending attempt.
- Raw provider/card data and secret keys never reach the browser or billing
  tables. The frontend receives only the safe attempt projection.
- RLS, live manager/session checks, explicit fixture ownership and the private
  Test gateway are required. Only the service-only provider RPC can fulfil a
  payment. Non-allowlisted businesses cannot start checkouts.

## Deployment

The secret `MYFATOORAH_SANDBOX_TOKEN` is installed only in hosted Test. Its
canonical local reference is in the ignored coordination credentials directory.
The approved sandbox key expires on 24 December 2026. Do not commit or print it.

Apply only `ops/cloud-test/migrations/*_myfatoorah_*.sql` to Test. Keep the source
filenames aligned with the versions returned by the migration tool. Deploy
`myfatoorah-subscription` with the Supabase connector, its `handler.ts` and shared
`test-boundary.ts`. JWT gateway validation is disabled because the function body
independently authenticates the private gateway and manager JWT/session.

**Do not run Supabase remote commands from the repository's local configuration.**
Its `[edge_runtime.secrets]` contains local defaults; the CLI can import those
over hosted settings even during a secrets/deploy command. Use the connector,
or an isolated remote work directory with no local secret defaults and an
explicit Test project reference. Verify `APP_ENV=cloud-test`, the hosted
`APP_URL`, and the gateway after any secret change.

Build with `npm run build:cloud-test` and deploy the existing Test Worker via
`wrangler deploy --config wrangler.cloud-test.jsonc`. Preserve the current Test
baseline, Worker secrets, access gate, private inbox and native Test gateway.
Do not deploy this branch or these provider migrations to production.

## Verification

- `npm run check` and `npm run test:cloud-gateway`.
- `ops/cloud-test/tests/myfatoorah-subscription.sql` creates disposable fixtures
  inside a rollback transaction. Its 31 scenario groups include the original 16
  pricing/ownership/fulfilment/privilege assertions and expanded UPayments parity
  checks. It does not reset the owner's subscription or payment history.
- `ops/cloud-test/tests/myfatoorah-booking-matrix.sql` adds 17 disposable,
  rollback-only booking scenarios. Run the existing `myfatoorah-booking.sql`
  and `myfatoorah-booking-approval.sql` suites alongside it.
- Handler tests cover sandbox origin pinning, exact KWD, idempotent creation,
  foreign evidence rejection, successful capture, declined retry, return-loss
  recovery, cancellation, transport failures and verified terminal invoices.
  Pending invoices with `CANCELED` transactions remain retryable. They must not
  be treated as paid or as terminal merely because the customer cancelled KNET.
- Hosted browser: discounted KNET subscription, card/3-D Secure extra place,
  declined 3-D Secure without activation, PDF download, mobile, English/Arabic,
  light/dark. Private test references/results stay under `.cloud-test/`.

The [verification report](myfatoorah-sandbox-verification.md#upayments-scenario-parity--25-november-2026)
separates actual sandbox journeys, SQL contract tests, mocked provider checks and
unimplemented refund/webhook/wallet scenarios. A passing guard is not evidence
that the corresponding MyFatoorah payment feature exists.

Official references: [Hosted payment page](https://docs.myfatoorah.com/docs/v3-hosted-payment-page),
[Create payment](https://docs.myfatoorah.com/reference/create-payment),
[Payment details](https://docs.myfatoorah.com/reference/get-payment-details),
[Invoice details](https://docs.myfatoorah.com/reference/get-invoice-by-invoiceid),
[Idempotency](https://docs.myfatoorah.com/docs/idempotency),
[Test cards](https://docs.myfatoorah.com/docs/test-cards).


## Website booking pilot — 25 November 2026

The owner's **MyFatoorah Sandbox — card** shop is enabled for website booking
payments, with Jassim Mohammad, Beard Trim and Haircut. Its manager can choose
pay at shop, online, or both using the existing Test payment settings. It is
currently published, with both methods and Jassim's auto-confirmation enabled.

The server chooses the gateway by the private shop allowlist; a customer cannot
switch another shop's provider. Only the authenticated Test website uses the
MyFatoorah adapter. Native and legacy clients keep the previous adapter.

The existing Test booking-attempt table is shared so every booking writer honors
the same reservation locks. Each attempt has an explicit provider; MyFatoorah
invoice IDs and creation claims are stored separately in the closed
`myfatoorah_test` schema. UPayments cannot capture, inquire or refund those
attempts. Settlement receipts have a MyFatoorah-specific source reference.

The customer selects KNET or card on the hosted MyFatoorah invoice. No customer
contact or card details are included in the provider create call. A browser
return cannot confirm anything; the stored invoice and successful transaction
are fetched server-side and checked against the exact KWD amount, identifiers,
paid invoice and successful transaction. Duplicate checks preserve one booking
and one receipt. Declined cards can retry the same invoice within the hold.
Uncertain creation never blindly issues another invoice. Check payment status
can recover without the provider return query. The existing authenticated Test
sweep also performs bounded MyFatoorah inquiries; it never posts a second create
or sends MyFatoorah refunds to UPayments.

Unfulfilled/late paid captures and cancelled paid MyFatoorah bookings are flagged
for refund review. Automatic MyFatoorah refunds are not implemented by this
booking-payment pilot. Do not describe this as a complete production payment
integration or release it to production.

Apply the two `*_myfatoorah_booking_*.sql` migrations only to hosted Test.
`ops/cloud-test/tests/myfatoorah-booking.sql` and
`myfatoorah-booking-approval.sql` run transactionally and roll back their fixtures.
The allowlist and synthetic settlement configuration are separately prepared
Test data, not hardcoded into those migrations.
