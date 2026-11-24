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

This first integration covers subscriptions and additional places. MyFatoorah
customer booking payments, B-Wallet top-ups, refunds, webhook configuration and
production activation are separate work. Their existing UPayments Test flows
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
- `ops/cloud-test/tests/myfatoorah-subscription.sql` uses the pristine dedicated
  card fixture, performs 16 pricing/ownership/fulfilment/privilege assertions,
  and rolls back all writes. It stops if that fixture already has a real attempt.
- Handler tests cover sandbox origin pinning, exact KWD, idempotent creation,
  foreign evidence rejection, successful capture, declined retry, return-loss
  recovery and verified terminal invoices.
- Hosted browser: discounted KNET subscription, card/3-D Secure extra place,
  declined 3-D Secure without activation, PDF download, mobile, English/Arabic,
  light/dark. Private test references/results stay under `.cloud-test/`.

Official references: [Hosted payment page](https://docs.myfatoorah.com/docs/v3-hosted-payment-page),
[Create payment](https://docs.myfatoorah.com/reference/create-payment),
[Payment details](https://docs.myfatoorah.com/reference/get-payment-details),
[Invoice details](https://docs.myfatoorah.com/reference/get-invoice-by-invoiceid),
[Idempotency](https://docs.myfatoorah.com/docs/idempotency),
[Test cards](https://docs.myfatoorah.com/docs/test-cards).
