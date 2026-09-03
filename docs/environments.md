# Environment Architecture

## Isolation contract

Local, staging, and production must not share a database, Storage volume, JWT
secret, Vault secret, SMTP credential, WhatsApp application/number, Anthropic
key, or infrastructure credential. Production data must never be restored into
local or staging.

Local runs from the pinned npm Supabase CLI and `supabase/config.toml`. Staging
runs on its own hardened VPS with a separate pinned self-hosted Supabase stack.
Production retains its existing database and Storage and replaces only the
frontend deployment with the immutable Nginx image.

## Runtime values

Dokploy supplies these frontend container values:

| Value | Staging | Production |
|-------|---------|------------|
| `APP_ENV` | `staging` | `production` |
| `APP_URL` | `https://staging-barber.malabdullah.cloud` | production origin |
| `SUPABASE_PUBLIC_URL` | `https://supabase-staging.malabdullah.cloud` | production API origin |
| `SUPABASE_REALTIME_URL` | staging WSS origin | production WSS origin |
| `SUPABASE_PUBLISHABLE_KEY` | staging browser key | production browser key |

The image supplies `APP_RELEASE` from the source commit. The startup script
rejects missing, insecure, or non-browser configuration and generates
`runtime-config.js` and the environment-specific CSP before Nginx starts.

Server-only values belong in the environment's Edge Function secret store:
`APP_ENV`, `APP_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`CRON_SHARED_SECRET`, SMTP credentials, WhatsApp credentials, Anthropic key,
and `OUTBOUND_RECIPIENT_ALLOWLIST`. Never use a `VITE_` name for these values.

## Staging boundary

Provision 4 vCPU, 8 GB RAM, and 100 GB SSD initially. Enable unattended security
updates, SSH keys only, a default-deny firewall, non-root administration, disk
and resource alerts, and off-host backups. Pin every Supabase component image;
test version upgrades here for at least 72 hours.

Place the frontend, API, and Studio behind Cloudflare Access. Create explicit
bypass rules only for the exact Meta webhook and Flow paths. Those endpoints
must still verify Meta signatures and staging-specific verification secrets.
Use a dedicated WhatsApp test number, sandbox SMTP account, recipient allowlist,
test Flow IDs, and restricted Anthropic key.

Configure SMTP itself with a staging recipient allowlist or sink transport; the
application phone allowlist is not a substitute for mail-provider enforcement.

## Local production guard

Runtime validation accepts HTTP only on `localhost`, `127.0.0.1`, or `::1` in
development/test, and rejects any remote Supabase origin. Production and staging
require HTTPS. Local function secrets are ignored by Git.
