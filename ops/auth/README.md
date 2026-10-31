# Production Apple OAuth credential renewal

This root-only infrastructure job reuses the existing Apple Services ID, Team ID,
Key ID and P-256 signing key. It changes only `GOTRUE_EXTERNAL_APPLE_SECRET` in the
active production Compose override. It never queries or changes customer data,
creates accounts, revokes sessions or changes the Auth JWT signing key.

The timer checks daily at 01:05 UTC (04:05 Kuwait), with up to five minutes of
jitter and catch-up after downtime. Credentials last 180 days; renewal starts
30 days before expiry. A fresh credential causes no Auth restart. Failures retry
hourly. Renewal recreates only Auth on the same pinned image, checks health and
all other Auth environment values, and verifies the database and Functions were
not restarted. Existing sessions remain valid; sign-in requests can briefly be
unavailable while Auth restarts.

The existing backend release lock serializes configuration updates with releases.
Compose model drift or an unexpected signing identity fails closed. Updates use
private atomic files and a durable journal. An unhealthy replacement restores the
previous override and Auth configuration. An interrupted update is reconciled by
restoring the recognized prior configuration before retrying; unknown operator
changes are never overwritten. No database backup is restored during recovery.

## Installation

Use a separately reviewed production operation. Store all private inputs and state
under `/etc/barber-release/apple-renewal/` (root, directories 0700, files 0600),
which is already included in the encrypted production configuration backup.
Production credentials never belong in Test. The tests use generated synthetic
keys and a fake runtime; no localhost or Docker Test stack is needed.

Install the tracked script at `/usr/local/lib/barber-release/apple_renewal.py`,
and the service/timer at `/etc/systemd/system/`. Keep copies of these three public
files alongside the private configuration for recovery. Configure `config.json`:

```json
{
  "environment": "production",
  "teamId": "EXISTING_TEAM_ID",
  "keyId": "EXISTING_KEY_ID",
  "clientId": "EXISTING_SERVICES_ID",
  "keyFile": "/etc/barber-release/apple-renewal/signing-key.p8",
  "overrideFile": "/etc/barber-release/prepared-backend-runtime.override.json",
  "composeFile": "/root/supabase/docker/docker-compose.yml",
  "composeDirectory": "/root/supabase/docker",
  "stateDirectory": "/etc/barber-release/apple-renewal/state",
  "backendLockFile": "/var/lib/barber-release-backend/backend.lock",
  "authImageId": "sha256:CURRENT_REVIEWED_AUTH_IMAGE_ID"
}
```

Confirm the actual backend state directory and pinned Auth image on installation.
Run the synthetic tests, inspect the current token and live model, then execute
one `--force` renewal to verify the full live installation. This is a credential
refresh, with no new Apple registrations or permissions. Run the service normally
to verify the fresh-token no-op, then enable its timer. Verify `systemd-analyze
verify`, service success, next scheduled run, provider availability, unchanged
service identities and data counts. Keep temporary operator SSH access limited
and remove it afterward. Never log private keys, JWTs or Docker environment data.

The active override is the live credential source. Initial setup snapshots in
`customer-production-20261031` are historical; do not reapply them over the live
override. Restored installations must retain the private key/configuration and
reinstall the tracked script and timer before enabling renewal.

## Operations

- `systemctl status barber-apple-renewal.timer barber-apple-renewal.service`
- `systemctl list-timers barber-apple-renewal.timer`
- `cat /etc/barber-release/apple-renewal/state/state.json` (expiry/status only)
- `systemctl start barber-apple-renewal.service` (safe fresh-credential check)

For a failed unit, inspect its journal and the protected state phase. Correct key,
clock, permissions or model drift before retrying. Do not clear an interrupted
journal or overwrite unrecognized configuration. Apple key revocation/replacement
requires an intentional operator update; this job renews the JWT for the existing
key and Services ID.

References: [Apple token generation](https://developer.apple.com/documentation/signinwithapplerestapi/generate-and-validate-tokens),
[Supabase Apple OAuth rotation](https://supabase.com/docs/guides/auth/social-sign-in/auth-apple),
[Compose config hash](https://docs.docker.com/reference/cli/docker/compose/config/).

## Hosted Test equivalent

Managed Test does not use the production VPS/Compose renewal service. Its separate
scheduled Worker is `barber-test-apple-renewal`, configured by
`wrangler.apple-renewal.jsonc` and `ops/cloud-test/apple-renewal.js`. It uses only
Test's existing Apple key `SPT3287JRA` and Services ID
`com.barberplusplus.authentication.test.web`.

Install a dedicated Supabase scoped PAT with **Auth Config read-write only** on
project `qvkucvcjmojjbphlzlks`. Store it as Worker secret
`SUPABASE_AUTH_CONFIG_TOKEN`, and the Test PKCS#8 key as `APPLE_SIGNING_KEY`.
Never use the CLI's legacy account-wide PAT or a production key. Approval is
required before creating this persistent service access. Keep both secrets out
of the website Worker, frontend assets, logs and Git.

Bind a private KV namespace as `RENEWAL_STATE`; never attach that namespace to the
website Worker. Its state contains a private signed JWT and an interrupted-update
journal. There is no HTTP trigger, workers.dev route or preview URL. The hourly
cron checks the credential and renews a 180-day ES256 JWT 30 days before expiry;
failed runs retry at the next hourly check. Initialization creates a fresh Test
credential. Subsequent checks verify its signature, registration and opaque Auth
configuration fingerprint. An interrupted PATCH reuses the exact journaled JWT.

The only Management API write is PATCH of `external_apple_secret` on the fixed
Test project. All remaining Auth settings are compared before/after; the job does
not read or write customer/database records. External credential changes stop the
job until its private state is deliberately reconciled. Inspect Cloudflare's
scheduled-event errors and private KV `checkedAt`, `renewedAt` and credential
expiry for operational verification. Do not publish KV values. Disable the cron
to pause renewal; this retains the valid credential and all Test data. Deleting
its scoped PAT revokes only this job's managed Test access.
