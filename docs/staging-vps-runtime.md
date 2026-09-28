# VPS runtime safeguards — implementation, not deployment acceptance

These files prepare only the isolated staging runtime on `srv1207055`. The
Mac-targeted deployment workflow has **not** been converted yet. Do not merge
or treat these components as a working VPS deployment.

## Test email

`ops/staging-vps/compose.override.yml` connects Auth to `mailpit:1025` on the
separate `barber-staging-mail-sink` internal Docker network. Only Auth and
Mailpit join this network. Auth also joins the normal staging bridge; Mailpit
does not. No SMTP credentials are needed. Only synthetic `@barber.test`
addresses are accepted; real addresses fail instead of silently sending mail.

The Mailpit image is pinned to:

`axllent/mailpit:v1.31.3@sha256:ed9b00c609e77e99c79b93f1178255ebc271868920f2c69a8d166bd5634ed10d`

The process runs as UID/GID 10001, with no capabilities, no new privileges,
read-only root filesystem, 256 MB RAM limit and a 128 MB temporary inbox.
Restarting it intentionally discards synthetic test messages. No relay,
forwarding, webhook, external version check or reverse-DNS lookup is configured.
The Compose validator rejects extra mail environment variables/configuration,
changed recipients, shared/external networks, mutable images and published ports.

The inbox is not publicly routed through Cloudflare or Traefik. After deployment,
an administrator can discover its private IP with the narrowly filtered command
`sudo docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' barber-staging-mailpit`
and open an SSH local-forward to that private IP on port 8025. Verify the address
belongs to `barber-staging-mail-sink` first. Do not publish SMTP or add an
internet-connected network merely to access the inbox. Test the tunnel on the
actual VPS; local Docker Desktop cannot directly reach its Linux bridge IP.

Reproduce the isolated protocol test using a verified upstream scratch directory:

```sh
set -o pipefail
docker compose --project-directory /opt/barber-staging/supabase \
  --env-file "$upstream/.env.example" \
  -f "$upstream/docker-compose.yml" \
  -f ops/staging-vps/compose.override.yml config --format json \
  | node scripts/test-staging-mail-sink.mjs
```

This opt-in test pulls the pinned Mailpit and repository-pinned Node image. It
creates uniquely named, disposable resources, shares only the test sink's
network namespace with the probe, and removes them afterward. It starts no
Supabase services and accesses no database, integration or real message data.
It does not test Auth's invitation/reset flow; that needs the deployed stack.

## Self-hosted function gateway

`ops/staging-vps/functions/main/` must replace the upstream example `main`
directory in the release's staged function bundle. Include all eight actual
function directories and `_shared`, excluding every `.env*` file and test file.
Do not mutate a running release in place. The release packaging/deployment and
rollback scripts still need implementation and a real Edge Runtime rehearsal.

The explicit gateway policy is:

| Functions | Required authentication |
| --- | --- |
| auth-rate-limiter, get-kuwait-governorates, invite-barber, send-whatsapp-message | Valid JWT signed by the staging HS256 key or ES256/RS256 JWKS; expiration and role claims required. Application authorization still applies. |
| send-booking-reminders, cleanup-notifications | POST with staging `x-cron-secret`; JWT alone is insufficient. |
| whatsapp-webhook | GET with the staging verification token, or POST with valid Meta HMAC over the original body. |
| whatsapp-flow-endpoint | POST with valid Meta HMAC, followed by the function's encrypted-payload validation. |

Only exact function paths are accepted after Envoy's `/functions/v1/` rewrite.
Unknown names, trailing slashes, child paths and encoded aliases are denied.
Preflight accepts only the staging app origin and never invokes a worker.
Exceptions produce generic errors rather than returning credential-bearing
details. Meta request bodies are bounded to 100 KiB, including streamed bodies.

Supply independently generated staging `JWT_SECRET`, `SUPABASE_JWKS` (when
asymmetric signing is used), `CRON_SHARED_SECRET`, `WHATSAPP_APP_SECRET` and
`WHATSAPP_VERIFY_TOKEN` through the protected function environment. Missing
credentials keep the affected routes closed. Never set the upstream global
JWT toggle to false as a shortcut. The custom gateway ignores that toggle;
the overlay also keeps it true in case upstream main is installed by mistake.

Gateway tests cover HS256, ES256, RS256, expiration, wrong keys, missing secrets,
cron authentication, both Meta signatures, challenge checks, payload limits,
path boundaries, preflight, error sanitization and inventory/config.toml parity.
These use synthetic keys and stub workers, not the deployed app or Meta service.

## Remaining gates

1. Select and scan a compatible patched Supabase image set.
2. Complete immutable function packaging and real Edge Runtime compatibility,
   Linux/Dokploy deployment, backup and rollback implementation.
3. Provision unique staging secrets, initialize the baseline and synthetic seed,
   and test Auth against the private mail sink.
4. Configure dedicated Meta/Flow and restricted Anthropic test credentials;
   keep outbound calls disabled until allowlist/limit checks pass.
5. Implement encrypted backup transfer to the owner's selected Mac destination
   below and rehearse restoration.
6. Obtain release-specific owner approval, then cut over only staging DNS and
   complete VPS smoke, E2E, isolation, security and load acceptance.

Sources: [Mailpit runtime configuration](https://mailpit.axllent.org/docs/configuration/runtime-options/),
[self-hosted Supabase functions](https://supabase.com/docs/guides/self-hosting/self-hosted-functions).

## Owner-selected backup destination — September 28

The owner selected their own computer instead of a cloud-storage account.
Use `/Users/malabdullah/BarberBackups/staging`, outside the repository, for
encrypted **staging-only** backup archives. The folder and its parent were
created with mode 0700, owned by `malabdullah`. The disk had approximately
280 GiB available at the destination check; check capacity again before transfer.

This is a separate-device destination for the staging VPS, not an always-online
backup service. The Mac must be awake and connected when retrieving a backup.
Prefer Mac-initiated retrieval over authenticated SSH; do not expose a new
inbound service on the Mac. Do not give the VPS the backup decryption key.
Use a separate staging backup encryption key, protect it outside Git, and
arrange a recoverable second copy before relying on these archives.

Destination permissions, age encryption, authenticated SSH pull, ciphertext
checksum/authentication checks and synthetic-file recovery are now verified.
See `staging-backups.md` for paths, commands and evidence. A separate recovery
copy of the private key, consistent DB/Storage/config capture, scheduling,
freshness reporting and a full database/Storage restore rehearsal are **not
complete**. No automatic backup schedule has been created. Require
verified off-VPS backup evidence before any operation that needs a recoverable
backup; an offline Mac must not be reported as a successful transfer. No
production data or credentials belong in this folder. No live staging backup
exists yet because the new VPS stack is not deployed. The retained `fixture-`
archive is explicitly a synthetic transport test, never a real backup.
