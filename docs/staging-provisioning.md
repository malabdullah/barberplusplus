# Staging Provisioning Record

## Current VPS record

The manual private release went live on October 8, 2026. See
[live release and configuration](staging-live-acceptance.md) and
[closure execution](env3-closure-status.md). The VPS has eight isolated backend
services and one frontend; public application access uses Cloudflare Tunnel and
Access. The October 10 browser reauthentication reached the synthetic barber
workspace. Full fresh VPS inspection remains blocked by SSH access.

Recurring backup/monitoring implementation is prepared, not enabled. It must
pass fresh inspection, supervised capture, transfer and restoration before the
48-hour/two-cycle observation gate can begin. No final Env3 acceptance is claimed.

## Historical Mac provisioning record

The following is retained evidence, not current VPS instructions. Do not
register or deploy through the historical Mac runner.

Historical record reviewed: 2026-09-03. This document contains identifiers and secret names
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
- The repository is public on GitHub Free. Under the solo-owner policy approved
  on 2026-09-28, `main` still requires PRs, all five app-bound CI checks,
  administrator enforcement, stale-review dismissal, up-to-date branches and
  conversation resolution, and blocks force pushes/deletion. Only independent
  PR approval count and latest-push approval were removed, with explicit owner
  authorization covering shared main and its future production source role.
- PR #1 remains unmerged. A recorded code-review pass, owner release-specific
  approval, and all infrastructure/readiness gates are still required.
- Updated 2026-09-28: the `staging` environment now requires the owner
  `malabdullah` to approve each deployment and permits only protected branches.
  See `staging-owner-approval.md`. Production still requires its separate independent
  approval mechanism; no production GitHub environment is currently configured.
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
