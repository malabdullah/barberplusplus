# VPS runtime safeguards — implementation, not deployment acceptance

These files prepare only the isolated staging runtime on `srv1207055`. The
Mac-targeted deployment workflow has **not** been converted yet. Do not merge
or treat these components as a working VPS deployment.

## Minimal initial stack

On October 4 the owner approved keeping Hostinger/Dokploy and omitting four
optional Supabase services from initial staging: Studio, postgres-meta,
Supavisor and Imgproxy. This is an approved design reduction, not permission to
delete existing VPS containers/data or deploy a release. The eight configured
services are DB, API gateway, Auth, REST, Realtime, Storage, Functions and Mailpit.
Normal image/file uploads and downloads remain; server-side resizing is disabled.
There is no Supabase dashboard/management API or database pooler endpoint.
Administration remains through reviewed migrations and private SSH/database tools.
Dokploy management and its restricted account are unchanged.

`compose.override.yml` removes the four service definitions with `!reset`, not
profiles, removes the gateway's Studio dependency and Storage's Imgproxy
dependency, and explicitly sets `ENABLE_IMAGE_TRANSFORMATION=false` with no
Imgproxy URL. The validator requires the exact eight-service inventory and
rejects reintroduced services, missing core services, foreign dependencies,
enabled transformations or the old gateway template paths. Resource/load testing
is still required; fewer components do not by themselves establish capacity.

Bootstrap now needs Node and creates public, checksum-bound
`staging-cds.yaml` and `staging-lds.template.yaml` beside the unchanged upstream
Envoy files. The helper refuses existing outputs or changed upstream content.
For an existing verified **scratch** checkout with neither generated file:

```sh
node scripts/prepare-staging-envoy.mjs /absolute/verified/upstream
npm run test:staging-envoy-candidate -- /absolute/verified/upstream --minimal
```

Do not regenerate files over a live installation. The overlay mounts these two
files read-only. Management and fallback dashboard routes become explicit 403
responses after the existing authentication filters; anonymous dashboard requests
may still receive 401. Their backend DNS clusters are removed. Realtime uses the
Compose service DNS name, retaining the upstream tenant host rewrite. The exact
staging CORS policy and response-header guard are included. Browser, Cloudflare,
real Realtime/Functions and full-stack checks remain separate acceptance gates.

The opt-in gateway test runs the previously scanned Envoy 1.39.2 candidate. It
does **not** update the Compose image pin or clear its provenance/security gate.
The real core rehearsal now starts five services (DB/Auth/REST/Storage/Mailpit),
and its backup quiescence list no longer includes Imgproxy. Synthetic local
compatibility and recovery tests are not live backup or deployment evidence.

This reduces optional exposure but does not resolve the remaining Auth, Storage,
Realtime, image-provenance, migration, live-secret, backup, routing or load gates.
[Supabase supports omitting unused services and dependencies](https://supabase.com/docs/guides/self-hosting/docker).

### October 4 local validation of the reduced stack

The separate code-review pass caught and fixed a stale Imgproxy reference in
backup quiescence. This was a code review, not independent human approval.
Local validation passed:

- 87 staging topology/candidate/fixture/recovery tests, full `npm run check`,
  five Playwright journeys and `git diff --check`.
- Actual pinned upstream plus overlay Compose rendering, including the exact
  eight-service inventory and read-only generated gateway mounts; the compiled
  Functions overlay also passed with a syntactic, non-published image fixture.
- Minimal Envoy candidate authentication, denied management routes, restricted
  CORS, path/body/signature forwarding and isolated non-root execution tests.
- Five-service core rehearsal: Auth login and invitation captured by Mailpit,
  Storage upload/download and anonymous denial, disabled image transformation
  returning 404, four application migrations, 32 pgTAP assertions, randomized
  synthetic fixtures and duplicate-seed refusal.
- Encrypted DB/Storage/config tamper rejection and restoration into fresh local
  volumes, including Auth, RLS, Vault and private Storage verification.
- Generated gateway files match the tested transform; a repeated preparation
  attempt fails without overwriting either existing public file.
- Fresh local frontend Docker build and isolated runtime check: health, staging
  configuration, CSP, no-store, noindex, nosniff and UID 101 passed. Test image ID:
  `sha256:34a2f8290e6e3c8bec1a2891faa28fcd8b46feacc7a1021496b48137e583dc64`.
  It was not published or accepted as a release. Its disposable runtime had no
  network access or published ports and was removed after the check.

The core rehearsal used local PostgreSQL candidate
`sha256:b8aebc0a7bdcfd3eadc557f0d19999ee5f5d4a29590e03ba34d90acf783cbd92`
with the currently selected Auth/Storage versions, not the newly scanned upgrade
candidates. Playwright used the retained local synthetic development database;
the Envoy probe used stub backends. These results do not establish real Realtime
or Functions integration through Envoy, AMD64/VPS acceptance, live backups, or
clear outstanding image vulnerabilities/provenance. No image pins, production
resources, live VPS resources, DNS or account permissions changed in this work.

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

The custom gateway and all eight workers are now packaged from an explicit Git
commit, compiled to ESZIP archives, and included in a separate function image.
Do not copy the new main service into the old source-mounted Compose service:
it requires `/home/deno/bundles/*.eszip` and disables remote worker imports.
The Linux release executor, GHCR publication and rollback wiring remain open.

### Immutable function artifact

```sh
# Use a full reviewed commit and a new absolute directory, outside a live stack.
npm run package:staging-functions -- <full-commit-sha> /absolute/new/functions
docker build -f ops/staging-vps/Dockerfile.functions \
  -t barber-functions:reviewed /absolute/new/functions
```

The packager reads committed blobs only, never the working copy. It rejects
symlinks, unknown function directories, missing entrypoints and existing output
directories. Environment/dotfiles and test files are excluded without reading
their contents. Its manifest binds source commit, file SHA-256s and tree hash;
the verifier also rejects extra files and altered content. These checksums are
not a signature or a substitute for the protected release workflow.

The source app lock includes frontend/tooling dependencies that stalled the
standalone runtime. Packaging derives a function-only dependency closure,
retaining selected versions, dependency records and integrity hashes unchanged.
It preserves the original committed lock under `source-lock/deno.lock` and
recomputes the closure during verification. Missing/ambiguous references fail
closed. No dependency upgrade or lock-disable switch is used.

`ops/staging-vps/edge-runtime.image` and the Dockerfile pin the upstream
v1.74.0 image by OCI index digest
`sha256:2781daf92394db91f7e94129cc3d04ec474ad16a8fe64b3fbeef6e7d557ab120`.
The build downloads dependencies without any application credentials, then
bundles the gateway and every worker. The final image contains compiled
archives and the source manifest, runs as UID/GID 10001 and needs no source
mount or dependency download to start. Preserve the previous image digest for
rollback; never rebuild an already accepted release during promotion.

Before deployment, layer `compose.functions-image.yml` after the upstream file
and `compose.override.yml`, set `STAGING_FUNCTIONS_IMAGE` to the reviewed
`ghcr.io/malabdullah/barberplusplus-functions@sha256:...` digest, and pipe the
rendered configuration to `node scripts/check-vps-compose.mjs --compiled-functions`.
Missing image values, tags, another repository, root/writable operation and
source mounts fail this gate. The new layer overrides the upstream command and
removes its source/cache mounts. The older topology check alone is insufficient.
No GHCR function image has been published or deployed yet.

### Real runtime evidence — September 28

`npm run test:staging-edge-runtime` builds from committed source and starts a
disposable, non-root, read-only container on an internal-only network with no
published ports or host-data mounts. It uses freshly generated synthetic JWT,
Meta and RSA keys only; no DB/Auth credentials, Meta access token, Anthropic key
or real recipient data enters the build or container. Test containers/networks
and temporary source bundles are removed; the local compiled test image is
retained. This command is now part of application CI.

Commit `c9c5f2eedd1d03663577bd252befe76faad69bbb` passed a cold-start offline
rehearsal on local ARM64. Its tree hash was
`fa47e87e474972d4f2bdac1410695cd4ad4de92a3554ce1b69d25df499a9d6a2`,
and local image ID was
`sha256:ef02d6cbac27862c447615d02eb37ee6d0931d5ea747e94bf7231673699b66fb`.
All eight real workers booted. JWT/cron denials, exact paths, CORS, Meta GET and
signed POST, plaintext Flow rejection, encrypted RSA/AES Flow ping round-trip,
and signed-but-tampered ciphertext rejection passed. Expected missing-credential
responses verified worker boot without touching a database or sending messages.
The test found and fixed a real runtime issue: rebuilt, HMAC-verified requests
must retain Supabase dispatch metadata using `EdgeRuntime.applySupabaseTag`.
Unit tests now verify context is copied only after successful authentication.

This is not Envoy/Cloudflare integration, Linux AMD64 or VPS acceptance, a live
Meta end-to-end test, a component vulnerability scan, or a full service restore.

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
2. Complete Linux AMD64/VPS and Envoy checks for the compiled function image,
   plus Linux/Dokploy deployment, backup and rollback implementation.
3. Provision unique staging secrets, initialize the baseline and synthetic seed,
   and test Auth against the private mail sink.
4. Configure dedicated Meta/Flow and restricted OpenAI test credentials;
   keep outbound calls disabled until allowlist/limit checks pass.
5. Implement consistent live DB/Storage capture and rehearse restoration;
   encrypted transfer and recovery-key custody are already verified.
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
See `staging-backups.md` for paths, commands and evidence. Apple Passwords
recovery-copy storage, sync and synthetic decryption are verified. Consistent
DB/Storage/config capture, scheduling,
freshness reporting and a full database/Storage restore rehearsal are **not
complete**. No automatic backup schedule has been created. Require
verified off-VPS backup evidence before any operation that needs a recoverable
backup; an offline Mac must not be reported as a successful transfer. No
production data or credentials belong in this folder. No live staging backup
exists yet because the new VPS stack is not deployed. The retained `fixture-`
archive is explicitly a synthetic transport test, never a real backup.
