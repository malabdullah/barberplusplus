# Staging Provisioning Record

Last reviewed: 2026-09-03. This document contains identifiers and secret names
only. Never add credential values, private keys, tokens, recipient addresses, or
phone numbers.

## Current gate status

- VPS: **blocked** — no provider project, host/IP, or SSH target is available.
- Dokploy: **blocked** — no staging URL, API credential, or application ID is
  available.
- DNS, TLS, and Access: **blocked** — no Cloudflare zone/account identifiers or
  scoped API credential are available.
- Supabase: **blocked before deployment** — `supabase/.baseline-ready` is absent,
  so migrations and the synthetic seed must not be replayed.
- Integrations: **blocked** — no dedicated sandbox SMTP account, WhatsApp test
  application/number/Flow IDs, or restricted Anthropic credential is available.
- Local release checks: run the commands in **Validation evidence** before
  handing an immutable image digest to Dokploy.

No staging infrastructure was created during this review, and no production
resource or DNS record was changed.

## Minimal user actions to unblock provisioning

1. Create a dedicated Ubuntu LTS VPS with exactly 4 vCPU, 8 GB RAM, and 100 GB
   SSD. Add a staging-only SSH public key during creation. Provide its provider
   resource ID, public IP, initial non-secret SSH username, and host-key
   fingerprint through the approved operations channel.
2. Create a Cloudflare API token restricted to the
   `malabdullah.cloud` zone with only DNS edit and Access application/policy edit
   permissions. Provide the account ID and zone ID separately from the token.
3. Provide a staging-only Dokploy bootstrap/admin credential or approve the
   initial interactive setup. After bootstrap, replace it with a staging-scoped
   deploy API credential and record only the Dokploy application/project IDs
   here.
4. Create a sandbox SMTP account with a provider-side recipient allowlist or
   sink transport; a dedicated Meta test app and test number with staging Flow
   IDs; and an Anthropic key restricted by workspace, budget, and rate limit.
   Transfer values through the deployment secret store, not this repository.
5. Complete and approve `docs/database-baseline.md`. Commit the generated
   authoritative baseline, deterministic synthetic fixtures, database tests,
   expected schema, and finally `supabase/.baseline-ready`. Do not copy any
   production rows, Auth users, Storage objects, Vault values, or backups into
   staging.
6. Configure the GitHub `staging` environment variables and secrets listed
   below, then merge the reviewed changes to protected `main` to trigger the
   gated staging workflow.

## Provisioning specification

Before installing Dokploy, create a non-root administrator, disable password and
root SSH login, enable unattended security updates, and configure a default-deny
firewall. Allow SSH only from the approved administration source and expose only
HTTP/HTTPS required by the reverse proxy. Do not expose PostgreSQL, Supavisor,
Studio, Docker, or Dokploy management ports directly to the Internet. Enable
off-host encrypted backups and alerts for disk, memory, CPU, container health,
TLS expiry, and backup freshness.

Install Dokploy from its reviewed official release. Create a staging-only
project and networks. Deploy a Supabase self-hosted snapshot pinned to one
`self-hosted/v*` release and retain every image tag/digest as an artifact; do not
mix individually upgraded component tags. Give Postgres and Storage separate
staging-only persistent volumes and encrypted off-host backup targets. Deploy
the Barber++ frontend by immutable GHCR digest with the runtime values in
`docs/environments.md`.

The repository pins the compatible Supabase Docker snapshot by reviewed release
tag and immutable commit in `ops/supabase/`. On the new host, install and verify
it with:

```sh
scripts/bootstrap-staging-supabase.sh /opt/barber-staging/supabase
# Complete the pinned upstream setup and store generated values outside Git.
scripts/verify-staging-supabase.sh /opt/barber-staging/supabase
scripts/audit-staging-host.sh
```

Generate every Supabase credential fresh on the staging host. This includes
passwords, JWT signing material, public and private API credentials, encryption
material for Realtime and Vault, Storage access, and dashboard access. Set the
staging Auth site and exact
redirect URLs to `https://staging.barber.malabdullah.cloud`. Store only secret
names and non-secret resource identifiers in documentation.

## Cloudflare boundary

Create proxied DNS records, without changing any existing production record:

- `staging.barber.malabdullah.cloud` -> staging reverse proxy
- `supabase-staging.malabdullah.cloud` -> staging Supabase gateway

Use Full (strict) TLS with an origin certificate. Put the frontend and Supabase
gateway/Studio behind Cloudflare Access. Create bypass policies only for these
exact paths on the Supabase staging hostname:

- `/functions/v1/whatsapp-webhook`
- `/functions/v1/whatsapp-flow-endpoint`

Do not use wildcard prefixes or bypass `/functions/v1/*`. The webhook POST must
pass `X-Hub-Signature-256` verification and its GET challenge must match the
staging verify token. The Flow endpoint accepts encrypted Meta payloads only
outside local development; Meta's encrypted `ping` is its health check. Rate
limit both routes and cap request bodies at the edge. Confirm all neighboring
paths still redirect to or reject without Access.

## Required secret names

GitHub staging environment:

- `STAGING_DB_URL`, `STAGING_FUNCTION_DEPLOY_HOOK`,
  `STAGING_FUNCTION_DEPLOY_SECRET`
- `STAGING_BACKUP_CHECK_URL`, `STAGING_BACKUP_CHECK_TOKEN`
- `DOKPLOY_URL`, `DOKPLOY_API_KEY`, `DOKPLOY_APPLICATION_ID`
- `GHCR_PULL_USERNAME`, `GHCR_PULL_TOKEN`
- `ACCESS_CLIENT_ID`, `ACCESS_CLIENT_SECRET`
- variable `APP_URL=https://staging.barber.malabdullah.cloud`
- variable `SUPABASE_URL=https://supabase-staging.malabdullah.cloud`

Frontend application runtime:

- `APP_ENV`, `APP_URL`, `SUPABASE_PUBLIC_URL`, `SUPABASE_REALTIME_URL`,
  `SUPABASE_PUBLISHABLE_KEY`

Edge Functions and Supabase services:

- `APP_ENV`, `APP_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- `CRON_SHARED_SECRET`, `OUTBOUND_RECIPIENT_ALLOWLIST`
- `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`,
  `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_ID`, `WHATSAPP_APP_SECRET`,
  `WHATSAPP_FLOW_PRIVATE_KEY`, `WHATSAPP_BOOKING_FLOW_ID`,
  `WHATSAPP_SERVICE_FLOW_ID`
- `ANTHROPIC_API_KEY`
- the selected sandbox SMTP variables required by the pinned Auth release

Vault must contain fresh staging values for `booking_reminders_function_url` and
`cron_shared_secret`. Confirm their values differ from production by comparing
one-way fingerprints through the secret manager; never print either value.

## Readiness and deployment gates

Do not run `supabase db push`, `supabase db reset`, or the seed against staging
until `supabase/.baseline-ready` exists after review. Once it does:

1. Restore an empty staging database/Storage volume and record the backup ID.
2. Replay the approved migration baseline and subsequent migrations.
3. Apply only `supabase/seed.sql`; inspect counts and synthetic marker fields to
   prove there are no production identities or contact details.
4. Deploy the pinned Edge Function bundle and immutable frontend digest.
5. Run the checks below. Any failed isolation, outbound, signature, Access,
   backup, or restore check is a no-go.

The backup monitor endpoint must return a non-secret JSON attestation with
`environment: "staging"`, `status: "fresh"`, a `backupId`, and `checkedAt`.
The workflow checks this before migrations and stores the sanitized attestation
with the accepted release. It may also include `restoreTestedAt`.

## Validation evidence

Run locally before infrastructure handoff:

```sh
npm run check
npm run test:e2e
docker build --build-arg APP_RELEASE="$(git rev-parse HEAD)" -t barber-plus-plus:staging-check .
```

The GitHub staging deployment runs `scripts/staging-preflight.sh` before building
or mutating staging. The script requires the approved baseline, expected schema,
database tests, exact staging hostnames, and every deployment credential name;
it prints no values.

Run against staging with a Cloudflare Access service token:

```sh
SMOKE_APP_URL=https://staging.barber.malabdullah.cloud \
EXPECTED_ENV=staging EXPECTED_RELEASE=<commit-sha> \
ACCESS_CLIENT_ID=<from-secret-store> \
ACCESS_CLIENT_SECRET=<from-secret-store> \
sh scripts/smoke-environment.sh
```

Then run `scripts/validate-staging-boundary.sh`. It proves that the frontend,
REST API, and a neighboring function require Access; the two exact Meta paths
bypass Access; invalid webhook challenges/signatures fail; unencrypted Flow
payloads fail; and the served release/security headers match the deployment.

Record pass/fail evidence for frontend health and release identity, Auth
login/logout/reset/invite redirects, REST/RLS cross-role denials, Storage bucket
isolation, Realtime isolation, all role journeys, Arabic/English layout,
responsive rendering, CSP/security headers, TLS, Access default-deny and exact
bypasses, invalid webhook signatures, unencrypted Flow rejection, SMTP sink and
recipient allowlist, WhatsApp recipient allowlist, Anthropic limits, backup,
restore, and the absence of production identifiers/data.

## Non-secret resource identifiers

Fill these only after resources exist:

| Resource | Identifier |
|---|---|
| VPS provider/resource | pending |
| SSH host-key fingerprint | pending |
| Dokploy project/application | pending |
| Supabase self-hosted release | pending |
| Postgres volume | pending |
| Storage volume | pending |
| Frontend image digest | pending |
| Cloudflare zone/account | pending |
| Cloudflare Access applications/policies | pending |
| DNS record IDs | pending |
| Backup target/policy | pending |
| Sandbox SMTP account | pending |
| Meta test app/number/Flow IDs | pending |
| Anthropic restricted workspace/key ID | pending |
