# Cloud Test

The owner made this the default testing environment on 2026-10-31. Every app,
database and Functions change must be deployed and verified here before it is
reported ready. Use the localhost website or local Docker Test runtime only
when explicitly requested. Local builds, lint and unit checks can still run.
It does not depend on a Mac, Docker Desktop, a tunnel, or a self-hosted runner.

| Resource | Value |
| --- | --- |
| Website | https://barber-test.alabdullah-cs.workers.dev |
| Test email inbox | https://barber-test.alabdullah-cs.workers.dev/test-inbox |
| Cloudflare Worker | `barber-test` |
| Supabase project | `barber-test` / `qvkucvcjmojjbphlzlks` |
| Region | Mumbai / `ap-south-1` |
| Supabase dashboard | https://supabase.com/dashboard/project/qvkucvcjmojjbphlzlks |
| Source branch | `codex/cloudflare-supabase-test`, based on `dev` at `a9acf92` |

The initial hosted app is the development/Test snapshot at `a9acf92`, with the
cloud changes recorded in `7c7420e`. Its initial runtime release label is
`a9acf92-cloud-test`; it was not copied from the production website. The initial
database was rebuilt from development migrations and synthetic fixtures.
Verified on 2026-10-31: managed Supabase PostgreSQL 17.11 (image
`17.11.0.011`) and Auth/GoTrue `v2.197.0`. Supabase services have independent
versions and managed service versions may change.

On 2026-10-31 the owner requested synchronization with GitHub `dev` and a
production-structure baseline. The checkout reconciles hosted Test support with
the newer committed customer features and booking concurrency fixes. Each build
now records its exact Git commit in `runtime-config.js`; that commit must match
the deployed source and GitHub `dev` when reporting synchronization complete.

The hosted database was rebuilt transactionally from a fresh, sanitized
production schema-only export, then overlaid with the eight development
migrations after `20261029114557` and the two Cloud Test configuration migrations.
All 29 existing Test application/private tables retained their exact records;
Auth test accounts and Storage objects were preserved. No production rows, Auth
accounts, Storage objects or secret values were imported. The same rebuild was
first rolled back after passing all 11 database authorization suites. Hosted
browser, backend ownership and Realtime checks passed after the committed import.

The production reference archive is stored outside Git at
`/Users/malabdullah/Documents/Codex/Barber++-Supabase-Production-Structure-20261031/`.
It includes schema/role definitions without passwords, policies, triggers,
Functions source, extension/publication/bucket definitions, cron definitions,
Vault secret names only, and sanitized configuration/image references for all
11 services. Its manifest records checksums for each exported file.

Managed platform roles, Auth/Storage system schemas and service binaries remain
under Supabase's control. VPS administrator default privileges are retained in
the archive but not applied to managed service roles. Production SMTP, credentials
and callbacks are replaced by the existing Test inbox, secrets and URLs. The
copied cleanup cron schedule is present but disabled in Test.

## Access and test data

The website first asks for its test access username (`tester`) and a generated
password. Staff then sign in inside Barber++ using `admin@barber.test`,
`manager@barber.test`, `agent@barber.test`, or `barber@barber.test`. The second
manager (`manager-two@barber.test`) owns a separate shop for isolation tests.
Generated credentials are recorded in an owner-only local handover file,
`/Users/malabdullah/Documents/Codex/Barber++-Test-Access.txt`, and in ignored
`.cloud-test/credentials.json`. No production credentials or records were copied.
Do not commit either credential file or share them publicly.

Fixtures include six shops, thirteen services, nine barbers, a sample customer
and booking. Customer accounts can be created through the customer sign-up page.
Use synthetic addresses such as `customer@example.test` and synthetic phone
numbers. Guest and account bookings write only to the hosted test database.

## Email and external integrations

The Supabase Send Email hook captures Auth messages in a private test mailbox.
Customer confirmation and recovery use the same Auth mail adapter as production,
with the hook capturing those messages in the private mailbox. Open **Test email inbox** from the banner to follow links.
Messages expire from inbox listings after 24 hours. No actual email is delivered.
WhatsApp and paid AI integrations are not configured. Google and Apple sign-in
are enabled using the existing dedicated Test registrations. Google uses project
`barber-plus-plus-auth-test`; Apple uses Services ID
`com.barberplusplus.authentication.test.web`. Both register the provider callback
`https://qvkucvcjmojjbphlzlks.supabase.co/auth/v1/callback`. The customer's final
browser callback is `/customer/auth-callback` on the hosted Test website.

Real Google login, profile creation and sign-out passed. Real Apple login,
missing-name completion, private relay email and session persistence after a
refresh passed. The owner tested and accepted the hosted customer journey on
2026-10-31. Provider credentials remain private in ignored
`.cloud-test/customer-oauth.json`; never reuse production credentials. The
Apple renewal implementation uses a separate scheduled Worker and the dedicated
Test key. Its installation, scoped access and verification are described in
[the Auth operations runbook](../ops/auth/README.md#hosted-test-equivalent).
See also [customer social sign-in](customer-social-signin-test.md).

## Isolation and access controls

`cloud-test` is an explicit environment. Local Test continues to reject remote
backends. The browser requires a matching, explicitly selected Supabase project
reference and HTTPS. Cloud test Functions validate a server-only gateway secret
and the configured origin. Staff Functions additionally validate users and roles.
The Worker forwards only named Functions and never exposes that shared secret
to the browser. Supabase Auth, REST, Storage and Realtime use the test project
directly with normal user authorization and RLS.

Every website asset and the inbox pass through the test access gate. A secure
HttpOnly cookie allows staff bearer tokens to coexist with that gate. Password
rotation invalidates the gate cookie. Responses use no-store caching, noindex
headers and a CSP restricted to the test backend. The free Worker request quota
therefore includes website asset requests as well as gateway requests.

Application migrations are replayed with their original versions. The separate
`ops/cloud-test/migrations/` files create the private mailbox and restrict legacy
RPC privileges only in this test project; they must not be included in production
deployment. No cron job calls the retired reminder service.

## Maintenance and validation

Use Node 24.20.0. `npm run build:cloud-test` produces the frontend and its public
runtime configuration, then prepares the Cloudflare asset manifest. The checked-in
`wrangler.cloud-test.jsonc` describes only this Worker. Deployment used the
connected Cloudflare API: open an assets upload session, upload the requested
buckets with `node ops/cloud-test/assets.mjs upload`, then upload the Worker
module with the completion token and secrets. Existing secret bindings must be
preserved on updates. The CLI alternative is `wrangler deploy --config
wrangler.cloud-test.jsonc` after authenticating the CLI and setting its secrets.

The hosted Supabase project is deliberately not linked to the local Test profile.
For remote commands always specify `--project-ref qvkucvcjmojjbphlzlks`. Auth
configuration is stored in ignored `.cloud-test/supabase/config.toml`. Run config
push with the process working directory set to `.cloud-test`, and place its
absolute `--workdir` option before `config push`. With the installed CLI, a
trailing `--workdir` selected the repository's local configuration instead.
Do not use an affirmative push as a preview: agent mode can apply changes without
a prompt. Supply `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET` and
`SUPABASE_AUTH_EXTERNAL_APPLE_SECRET` privately from the Test OAuth file, and
verify the hosted site/callback URLs, email confirmation, disabled phone signup
and provider settings after any push. Edge Functions deploy with independent gateway,
user, or cron authentication in their bodies. Gateway JWT verification is disabled
for this hosted test deployment to support the project's signing-key format.

Validation commands:

```sh
npm run check
npm run test:cloud-gateway
npm run test:cloud-backend
npm run test:cloud-customer
npm run test:e2e:cloud
```

Backend probes cover all staff logins, cross-shop read/write denial, anonymous
RPC denial, private mailbox denial, avatar ownership policies, privileged Function
authorization and captured Auth recovery email. Browser checks cover all four
staff workspaces, responsive Arabic/light layouts, guest booking and customer
email confirmation. Reports, screenshots and operational secrets stay in ignored
`.cloud-test/`; browser traces/videos are disabled to avoid recording tokens.

The deployment was quoted at $0 for Supabase. Supabase Free may pause after a
week of low database activity and must then be restored from its dashboard.
Hosting remains subject to each provider's plan and usage limits; no paid upgrade
or new subscription was requested. This managed backend does not provide exact
version parity with the self-hosted production stack.

The private hook's Auth email quota is 1,000 captured messages/hour; nothing is
sent externally. App request limits remain enabled. Set `rate_limit_email_sent`
through the Management API: the pinned CLI's `config push` does not synchronize
this field. For config pushes, run the CLI from `.cloud-test` with global
`--workdir` before the subcommand and inspect its diff before approving; the
repository's local settings must never replace the hosted origins or hook.
