# Environment Architecture

## Current staging architecture

Staging is deployed on `srv1207055` (`185.97.146.8`), the dedicated two-core,
8 GiB VPS approved for initial testing. The backend is `barber-staging-private`
(eight services); the frontend is `barber-staging-frontend`. Both Docker networks
are internal, with no published container ports. Cloudflare Tunnel reaches the
private bridge origins documented in [live acceptance](staging-live-acceptance.md).

Browser HTTP and WSS calls use `https://staging-barber.malabdullah.cloud`.
The ordered `/v1` API-family route precedes the frontend catch-all. The separate
`supabase-staging.malabdullah.cloud` hostname retains the two exact signed Meta
exceptions; their neighboring paths and all frontend-host API paths need Access.

Data, Auth/JWT, Vault, Storage, mail sink and integration configuration are
dedicated to staging. Synthetic fixtures only; external AI/WhatsApp and database
cron remain disabled. Deployment is manual and owner-approved; automatic
deployment stays disabled. GitHub-hosted CI publishes immutable artifacts.

The Mac is the encrypted recovery destination and planned monitoring host,
not the current staging application host. Current operational implementation,
installation gates and pending evidence are in [Env3 operations](env3-operations-runbook.md).
Do not use historical Mac deployment helpers for the VPS.

## Historical Mac architecture — retained for evidence only

The following describes the superseded Mac staging lab and is not an active
deployment procedure. Development may still use its own local Supabase stack.

## Isolation contract

Local staging and production must not share a database, Storage volume, JWT
secret, Vault secret, SMTP credential, WhatsApp application/number, OpenAI
key, or infrastructure credential. Production data must never be restored into
the local staging lab.

Staging runs on the dedicated Docker Desktop stack on the approved Mac. GitHub
Actions uses the repository-scoped `barber-staging-mac` runner only for the
deployment job; CI and image construction remain on GitHub-hosted runners.
Production remains on its existing self-hosted Supabase and Dokploy services.

## Runtime values

The local staging deploy helper and production Dokploy supply these frontend
container values:

| Value | Staging | Production |
|-------|---------|------------|
| `APP_ENV` | `staging` | `production` |
| `APP_URL` | `https://staging-barber.malabdullah.cloud` | production origin |
| `SUPABASE_PUBLIC_URL` | `https://supabase-staging.malabdullah.cloud` | production API origin |
| `SUPABASE_REALTIME_URL` | derived staging WSS origin | production WSS origin |
| `SUPABASE_PUBLISHABLE_KEY` | local staging browser key | production browser key |

The image supplies `APP_RELEASE` from the source commit. The startup script
rejects missing, insecure, or non-browser configuration and generates
`runtime-config.js` and the environment-specific CSP before Nginx starts.

Server-only staging values are stored at owner-only permissions below the
runner root, outside Git, and are read only by the Edge Functions service.
Production values remain in the production secret store. Never use a `VITE_`
name for server-only values.

## Staging boundary

Cloudflare Tunnel exposes only the frontend on local port `8080` and the
Supabase gateway on local port `54321`. Cloudflare Access defaults to deny and
permits the owner identity and the CI service token. Bypass rules apply only to
the exact Meta webhook and Flow paths; those handlers still validate their
staging-specific signatures and encrypted payload requirements.

The lab contains deterministic synthetic data only. Sandbox or sink credentials
and recipient allowlists are required before testing outbound email, WhatsApp,
or OpenAI behavior. The database, Studio, Mailpit, Kong, and analytics port
bindings must be restricted to loopback as a separate host-hardening task.

## Local production guard

Runtime validation accepts HTTP only on `localhost`, `127.0.0.1`, or `::1` in
development/test, and rejects any remote Supabase origin. Production and staging
require HTTPS. Local function secrets are ignored by Git.
