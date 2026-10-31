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
The custom customer-auth flow captures its confirmation and recovery links in
the same mailbox. Open **Test email inbox** from the banner to follow links.
Messages expire from inbox listings after 24 hours. No actual email is delivered.
WhatsApp and paid AI integrations are not configured. Google and Apple sign-in
remain disabled until provider-specific accounts and credentials are supplied.

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
push from that directory with its absolute `--workdir`, so the local Test config
cannot be selected accidentally. Edge Functions deploy with independent gateway,
user, or cron authentication in their bodies. Gateway JWT verification is disabled
for this hosted test deployment to support the project's signing-key format.

Validation commands:

```sh
npm run check
npm run test:cloud-gateway
npm run test:cloud-backend
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
