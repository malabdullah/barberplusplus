# Staging Provisioning Record

Last reviewed: 2026-09-03. This document contains identifiers and secret names
only. Never add credential values, private keys, tokens, recipient addresses, or
phone numbers.

## Implemented staging lab

- Host: the approved Apple Silicon Mac running Docker Desktop.
- GitHub runner: repository-scoped `barber-staging-mac`, labels `self-hosted`,
  `macOS`, `ARM64`, and `barber-staging`; installed as a launch service outside
  Documents so macOS background privacy controls do not block it.
- Supabase: isolated local CLI project `barber-plus-plus`, with staging-only
  database and Storage volumes and the approved baseline/migrations.
- Frontend: `barber-staging-frontend`, bound to `127.0.0.1:8080` and deployed by
  immutable GHCR digest.
- Public hosts: `staging-barber.malabdullah.cloud` and
  `supabase-staging.malabdullah.cloud`, both routed through Cloudflare Tunnel.
- Access: owner email and CI service token are allowed; all other requests are
  denied except the two exact Meta endpoints below.

No production service, credential, data, volume, DNS record, or Dokploy
application is used by this staging lab.

## Cloudflare boundary

The tunnel routes are:

- `staging-barber.malabdullah.cloud` -> `http://localhost:8080`
- `supabase-staging.malabdullah.cloud` -> `http://localhost:54321`

Cloudflare Access bypass applies only to:

- `/functions/v1/whatsapp-webhook`
- `/functions/v1/whatsapp-flow-endpoint`

Do not use wildcard prefixes or bypass `/functions/v1/*`. The webhook POST must
pass `X-Hub-Signature-256` verification and its GET challenge must match the
staging verify token. The Flow endpoint accepts encrypted Meta payloads only
outside development. Neighboring paths must remain protected by Access.

The tunnel token and Access service-token export are stored outside Git with
owner-only permissions. GitHub stores only `ACCESS_CLIENT_ID` and
`ACCESS_CLIENT_SECRET` in the `staging` environment for acceptance checks.

## GitHub staging environment

Variables:

- `APP_URL=https://staging-barber.malabdullah.cloud`
- `SUPABASE_URL=https://supabase-staging.malabdullah.cloud`

Secrets:

- `ACCESS_CLIENT_ID`
- `ACCESS_CLIENT_SECRET`

The self-hosted runner reads Edge Function values from its protected local
`.secrets/functions.env`. These values are not uploaded to GitHub. The file
contains staging-only or synthetic values for `APP_ENV`, `APP_URL`, cron,
recipient allowlists, SMTP, WhatsApp, Flow, and Anthropic settings. Supabase
injects its local URL and API keys when the functions runtime starts.

## Deployment and backup behavior

After a successful `CI` push run on `main`:

1. A GitHub-hosted runner builds and pushes one SHA-tagged image to GHCR.
2. The Mac runner validates the exact hosts, immutable digest, approved database
   baseline, protected local paths, Docker availability, and isolated containers.
3. It creates owner-only custom-format Postgres and compressed Storage backups
   below the runner root. Only checksums, sizes, and identifiers are uploaded.
4. It dry-runs and applies local migrations with `--skip-vault`.
5. It copies the reviewed Edge Functions and pinned CLI into commit/version
   addressed directories, then replaces the persistent launch service.
6. It deploys the frontend by digest while retaining the prior container.
7. Smoke, boundary, and Playwright checks run through Cloudflare Access.
8. Success uploads the accepted release and backup evidence, then finalizes the
   retained frontend and Function state. Failure restores both prior runtimes.

Backups currently remain on the same Mac. An encrypted off-device copy and a
restore rehearsal are still required before this lab can be treated as durable.

## Required gates and open risks

- `supabase/.baseline-ready`, `supabase/schema.expected.sql`, deterministic seed
  data, pgTAP tests, and timestamped migrations are present and locally verified.
- Cloudflare Tunnel, DNS, TLS, Access default-deny, CI service-token access, and
  exact webhook bypass checks have passed.
- The GitHub `staging` environment and repository-scoped runner are configured.
- The repository is public on GitHub Free. `main` has server-side protection,
  includes administrators, requires all five CI checks and one independent
  approval, dismisses stale approvals, requires latest-push approval and
  conversation resolution, and blocks force pushes and deletion.
- PR #1 still requires an independent approval before the merge/deployment gate
  can pass. Do not bypass or weaken the rule.
- The `staging` environment has no approval rule because staging deploys
  automatically after protected `main`; production still requires an
  independent protected approval mechanism.
- Local service ports other than the frontend remain broadly bound by the
  Supabase CLI and require loopback/firewall hardening.
- Sandbox SMTP, Meta test credentials, restricted Anthropic credentials,
  off-device backups, and a restore rehearsal remain pending.

## Validation commands

```sh
npm run check
npm run test:e2e
npm run check:staging-preflight
sh scripts/smoke-environment.sh
npm run check:staging-boundary
```

Record the CI and staging workflow URLs, commit, immutable digest, complete
migration set, backup evidence, acceptance results, and every unresolved defect.
