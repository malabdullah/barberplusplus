# VPS staging transition — preparation, not deployment acceptance

Updated 2026-09-28. This document supersedes the Mac hosting target in the older
staging runbooks; those describe the retained legacy implementation, not the
completed VPS target. No production resources are part of this transition.

## Approved target and current state

- Hostinger VPS `1207055`, hostname `srv1207055`, IPv4 `185.97.146.8`.
- The owner approved using the current 2 cores / 8 GB / 100 GB for initial tests,
  without purchasing an upgrade. Load/resource acceptance is still required.
- Non-root, staging-only SSH administration, key-only login and the provider
  firewall are already configured. Dokploy is accessed by SSH tunnel, not a
  public management port.
- Empty Dokploy project `LjKnNCq96dgPJacpmYaQ4`, staging environment
  `rc8PoRkFvVs4-uZOyGkKm`. No new VPS application/Compose stack exists yet.
- Canonical hosts are `staging-barber.malabdullah.cloud` and
  `supabase-staging.malabdullah.cloud`. DNS still targets the old tunnel.
- Protected Access app `ebd6beef-9faf-497a-b765-694aa8e3a39d` also protects
  `functions/v1/whatsapp-webhook/*` and `functions/v1/whatsapp-flow-endpoint/*`.
  These child-path rules override the exact endpoint bypass app. Trailing slash,
  child, deeper child, and neighboring-name probes require login.

## Prepared in this change

1. Corrected the Supabase source pin without upgrading the selected release.
   `self-hosted/v0.8.0` is an annotated tag object
   `e1af732589cd468edb49500ebc04e4367d4c56ad`; its actual source commit is
   `241bb11c0627f2981746d37033f57dbfa81d29b0`. Bootstrap now explicitly peels
   annotated tags. An online check detects a moved/mismatched release.
2. Added `ops/staging-vps/compose.override.yml` for the exact upstream stack.
   The configuration uses separate staging names/volumes and publishes only
   `127.0.0.1:18000` (API) and `127.0.0.1:15432` (DB). Pooler is not published.
   Bind data is confined to `/opt/barber-staging/supabase/volumes/`.
3. Added a secret-safe rendered-Compose validator and adversarial unit tests.
   The network name is not a claim of egress isolation: it is an ordinary
   staging-only bridge. A separate internal-only bridge now connects Auth to a
   pinned Mailpit sink. WhatsApp and Anthropic credentials and recipient
   allowlist remain empty during initial preparation. This is not VPS sandbox
   integration acceptance.
4. Added trailing-slash, child-path, and adjacent-name checks to the full
   Cloudflare acceptance script.
5. Added a non-root, read-only Mailpit v1.31.3 container pinned by digest. It has
   no published ports, relay, forwarding, webhook, or default external route.
   SMTP accepts only `@barber.test` recipients. Its size-limited temporary inbox
   is deliberately disposable on restart. See `staging-vps-runtime.md`.
6. Added a staging-only Edge Runtime main service with an exact function
   inventory, JWT verification, cron secrets, and Meta HMAC checks on both POST
   endpoints. Signed Flow payloads still pass through the application's
   encryption validation. Unknown, suffix, and encoded-alias routes are denied.
   Function source is mounted read-only. Installation and actual Edge Runtime
   compatibility are still deployment gates, not completed by these unit tests.

## Configuration-only verification

After fetching the pinned source into a new scratch directory using
`scripts/bootstrap-staging-supabase.sh`, render without starting any container:

```sh
npm run check:supabase-pin
npm run test:staging-vps
# Set upstream to the scratch directory containing the verified release.
set -o pipefail
docker compose --project-directory /opt/barber-staging/supabase \
  --env-file "$upstream/.env.example" \
  -f "$upstream/docker-compose.yml" \
  -f ops/staging-vps/compose.override.yml config --format json \
  | node scripts/check-vps-compose.mjs
```

Use a shell supporting `pipefail`. Never print rendered Compose JSON containing
real secrets. Never deploy with `.env.example`. Before live use, verify root-only
ownership and reject symlinks under the staging install tree; path validation
alone cannot establish filesystem ownership or secret isolation. Use Compose
2.24.4+ for `!override`; provider VPS currently has 2.40.3.

## Still blocking deployment

- The owner explicitly approved a shared-main solo-owner policy on 2026-09-28.
  A second account is unnecessary: retain PRs and CI, record a separate code
  review, and require owner release-specific approval plus GitHub staging
  environment approval. See `staging-owner-approval.md`. Neither PR has been
  merged and no release was approved by this policy change.
- The GitHub deployment workflow still targets the Mac. The Linux deployment
  executor, private Dokploy integration, backups, migration/seed procedure,
  Edge Runtime packaging/compatibility and rollback wiring must
  be implemented and reviewed before switching the workflow. The main-service
  authentication logic is now implemented and unit tested. Do not merely
  relabel the runner or merge the Mac workflow as a VPS solution.
- Independently generate staging DB/Auth/JWT/Vault/Storage/Function credentials.
  No production secrets or data may be copied. The validated migration baseline
  remains unchanged and has not been applied on the VPS.
- Review component security patches before choosing the deployable digest set.
  The retained v0.8.0 snapshot uses Postgres 17.6.1.136; Supabase's September 25
  advisory describes fixes in 17.11. The pin correction is not a security-upgrade
  approval. On September 28, v0.8.2 still pins 17.6.1.136, and the standard
  `supabase/postgres` 17.6.1.178 source still declares PostgreSQL 17.6. The
  separately named OrioleDB 17.11 release is not a drop-in approval for this
  stack. A compatible patched standard-Postgres image remains unresolved;
  do not claim the stack is patched or substitute engines without review.
- Deploy and verify the prepared sink-only SMTP service with Auth, add dedicated
  Meta test IDs/secrets and Flow keys, and a budget/rate-limited Anthropic key. Keep outbound integrations
  disabled until their restrictions pass tests.
- Configure an isolated VPS tunnel/origin with no direct-origin bypass; cut over
  only the two staging DNS records after service health is verified.
- Complete encrypted off-device backups and a restore rehearsal. Same-host
  legacy archives do not satisfy this gate.
- Run clean migration replay, pgTAP, synthetic seed verification, all service
  smoke checks, authenticated Access checks, signature/Flow failure paths,
  outbound containment, load checks, and complete E2E on the VPS.

## Local verification record

- Pinned source download/bootstrap and online tag-to-commit verification: passed.
- Actual upstream + VPS overlay Compose rendering/topology: passed.
- `npm run check` (lint, Edge Function checks/tests, unit/release/helper tests,
  frontend build, hardcoded-domain checks): passed. After the final SMTP
  quarantine addition, all 20 VPS tests and actual Compose rendering passed.
- Five Playwright journeys against existing synthetic-only local DB: passed.
- Local Docker image build: passed; not pushed, not an accepted release digest.
- Container `/healthz`, staging runtime/release, security headers, `noindex`,
  runtime `no-store`, and non-root UID 101: passed on loopback port 18081.
- Migration filename check, 32 transaction-rolled-back pgTAP assertions, and
  read-only schema drift comparison: passed against the local synthetic DB.
  A fresh reset/replay was not run against that existing database; preserve its
  state. Clean replay on the new stack remains a separate gate.
- `npm audit --omit=dev --audit-level=high`: zero production vulnerabilities.
  Full install reported two moderate development dependency advisories.
- Starting Docker Desktop resumed existing Mac staging containers. No database
  reset, production operation, or new VPS deployment was performed.

No VPS acceptance, full-stack image vulnerability scan, full restore rehearsal,
authenticated Cloudflare probe, or outbound integration test is claimed here.

## September 28 continuation

- Read-only SSH confirmed the target is still `srv1207055`, with 43 GB disk
  available, Dokploy running, and no new `/opt/barber-staging/supabase` stack.
  Neither production nor legacy data was changed.
- Prior commit `ed565a5`: all five GitHub checks passed. That result does not
  certify subsequent changes.
- New local checks: all 37 topology/pin tests and 19 gateway tests passed;
  `npm run check` passed, including lint, function checks, existing tests and
  frontend build. Actual upstream Compose rendering passed.
- The digest-pinned Mailpit container passed a real isolated Docker protocol
  test: one synthetic message captured, both outside-domain and suffix-spoofed
  recipients rejected, no published ports or IPv4/IPv6 default route. Temporary
  test containers/network were removed; no user data was involved. These tests
  are now included in the application CI job.
- These remain preparation changes on `codex/staging-vps`, not a deployed or
  accepted release. No owner deployment approval was consumed.
- Local frontend image build and a disposable loopback runtime passed health,
  staging configuration/release marker, CSP, `noindex`, `no-store` and UID 101
  checks. The test container was removed; the local image remains available.
- Browser rerun: four of five journeys passed initially; the manager's branch
  list appeared empty during its five-second assertion. That same journey
  passed on a targeted rerun without source or database changes. Treat this as
  an unresolved intermittent acceptance issue, not an unqualified E2E pass.
- A separate code-review pass checked the exact-route policy, signature-before-
  dispatch ordering, missing-secret behavior, JWT algorithm/key separation,
  secret-safe error responses, read-only mounts, mail relay restrictions, and
  temporary resource cleanup. This was an AI code-review pass, not an
  independent human review. Real worker/Envoy integration remains unverified.

Sources: [Supabase Docker deployment](https://supabase.com/docs/guides/self-hosting/docker),
[Envoy transition](https://supabase.com/changelog/48048-self-hosted-supabase-envoy-becomes-the-default-api-gateway-b),
[Postgres security advisory](https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes).
Version evidence:
[standard Postgres 17.6.1.178 source](https://github.com/supabase/postgres/blob/d3e9cb6b33b089f5185e5aca42257391dd631207/nix/config.nix),
[Supabase v0.8.2 Compose](https://github.com/supabase/supabase/blob/564eab8ad7840b13324f68b1bfac074ef8d51c21/docker/docker-compose.yml).
