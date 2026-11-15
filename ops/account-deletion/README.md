> Updated successor for review (14 November 2026): see [final contract](../../docs/customer-account-deletion-release.md). The earlier evidence below predates the production-compatible Apple additions. It is not final release authorization.

# Account deletion release controls

This is a default-off candidate, not production approval. Test retains its exact
project/origin pin, private inbox, immutable `cloud-test` database identity and
trusted disposable-QA allowlist. Production requires both application and database
configuration to agree. Nothing in this directory runs automatically.

## Configuration to review

`production.env.example` names only new settings; it contains no secret values.
`APP_ENV=production`, `APP_URL=https://www.barberplusplus.com` and the existing
`CUSTOMER_PUBLIC_API_URL=https://srv1073968.hstgr.cloud` must agree. The existing
`SUPABASE_URL` must match the explicitly reviewed
`CUSTOMER_ACCOUNT_DELETION_BACKEND_URL`. Unknown/internal aliases fail closed;
verify the real binding instead of broadening it during a release. The existing
approved Resend key stays server-side. The mail adapter uses only
`https://api.resend.com/emails`, `noreply@barberplusplus.com`, and Reply-To
`support@barberplusplus.com` with branded English/Arabic HTML/text.

The migration binds `deployment_environment` from the existing operator-owned
booking-email runtime. Unknown installations remain `unconfigured`. Neither the
normal API nor the operator RPC can turn a Test installation into Production.
The operator RPC requires service-role authorization and rejects the wrong
namespace, Test allowlist IDs in production, or stopping an unfinished cleanup.

Only inside the reviewed production release, use the restricted operator path:

```sql
select public.customer_deletion_runtime_configuration();
-- Must already identify production; never patch Test's namespace to get a pass.
select public.configure_customer_deletion('production', true, '{}'::uuid[]);
```

This permits the fixed production dispatch destination and normal customer
eligibility in the database. It **does not** enable the HTTP feature: both
`CUSTOMER_ACCOUNT_DELETION_ENABLED=true` and
`CUSTOMER_ACCOUNT_DELETION_CLEANUP_ENABLED=true`, plus the existing mail key and
verified URL bindings, are required for new requests. Activation is not performed
on production in this candidate. Test needs no production flag changes.

## Disable without abandoning accepted requests

Set `CUSTOMER_ACCOUNT_DELETION_ENABLED=false` to stop previews, starts, proof and
new confirmations. Leave `CUSTOMER_ACCOUNT_DELETION_CLEANUP_ENABLED=true` and the
database target enabled so already accepted operations can finish and receipt
status/retry continue. The worker authenticates with its separate server-only
random dispatch secret, keeps bounded leases/backoff and never accepts arbitrary
user IDs. After no `cleanup_pending` rows remain, the reviewed operator can
configure `p_enabled=false` and turn cleanup off. The RPC refuses to abandon
pending jobs. Disabling cannot recover anonymized data.

## Mail and retry behavior

A deterministic idempotency key depends only on the operation UUID and
server-issued send generation, never on identity/proof content. Test capture uses
a stable UUID derived from that key and never calls Resend, even if a provider key
exists. A duplicate start returns the original receipt and sends no second mail.
A resend creates a new code generation after its one-minute/three-send limit.
Provider errors/409/429, invalid acknowledgement and network uncertainty produce
only `EMAIL_UNAVAILABLE`; no automatic resend or provider diagnostics are logged.
Do not reuse a key with a different payload. Resend keeps provider idempotency
keys for 24 hours; this is not the account proof or receipt lifetime.

The email's button opens the same branded website screen without a proof token,
OTP, operation ID or receipt in the URL. Verification alone never deletes an
account; the current preview and explicit final cancellation confirmation remain
mandatory in the requesting app/site.

## Evidence and remaining release gates

The candidate has injected provider/environment tests, full application checks,
operator-control rollback tests and actual hosted Test captured-mail validation.
Function v3 and the environment binding are deployed to Test only. The main-based
business rollback suite passed on hosted Test without Reports dependencies. The
16-worker pinned Edge image rehearsal passed with synthetic settings and no public
ports, and its disposable container was removed. Docker was started only for this
approved compatibility check; no ordinary local website/Test stack was started.

The approved production inspection verified the four pinned image IDs, healthy
containers and all 15 selected routine hashes against main. The exact observed
internal gateway `http://api-gw:8000` is now supported only with an explicit matching
binding and the independent flags. Hosted Test v3 and 23 affected tests passed.
The exact-image PostgreSQL/Auth/Storage synthetic replay now passes all 47 SQL
suites (1,136 assertions), real API revocation/cleanup and the 501-object boundary.
The rebuilt public schema matches its reviewed snapshot. No production schema
export was needed; the full live migration ledger is not attested. Original firewall
profile 367995 is restored and the temporary source rule removed. Production
application, database and settings remain unchanged. Scoped
release packaging, live ledger verification, backups, privacy acceptance and final owner
release approval remain required. See `docs/customer-deletion-production-readiness.md`.

Sources: [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys),
[Resend API](https://resend.com/docs/api-reference/emails/send-email).


## Isolated platform rehearsal

`rehearse-platform.py` starts only uniquely labelled, disposable resources from
`ops/release/runtime-lock.json` on a local internal Docker network, with no public
ports, ordinary Test reset, production credentials, real delivery or active cron.
It bootstraps official Auth migrations, replays committed migrations, compares the
public expected schema, runs transaction-rolled-back SQL suites and exercises real
Auth/Storage APIs using synthetic customers. `platform_scenarios.py` owns those
API scenarios; `dump-rehearsal-schema.sh` formats a synthetic public schema only.

The completed run used the previously approved selected metadata in the ignored
`.release-private/production-readiness.jsonl`; that file contains no rows, secrets
or routine bodies. A future run needs an explicitly reviewed baseline and owner
permission for Docker rehearsal; this script does not inspect production or grant
permission to collect a new baseline. Run from the isolated main-based candidate,
not the Reports checkout. Aggregate results are committed under
`artifacts/customer-account-deletion-2026-11-13/platform-rehearsal-results.json`.
