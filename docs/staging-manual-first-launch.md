# Env3 manual-first launch — preparation, October 8, 2026

**Live private sandbox; same-host login fix verified.** The owner approved manual-first staging launch,
with automation remaining disabled. This changes the executor prerequisite,
not the exact-release approval, recovery, isolation or acceptance gates.
Production is out of scope. No code merge is authorized by this record.

## Exact application candidate

- Source: `6217cb33bd9aaf32aa0fa924278f314988449f12`, protected main/merged PR5.
- Successful main CI: `37747708348`; image publication: `37748167638`, attempt 1.
- Frontend: `ghcr.io/malabdullah/barberplusplus@sha256:4d656e8cf03535b14c7a1cd5d55c604e0bb172147777102d854ae6f329659aab`.
- Functions: `ghcr.io/malabdullah/barberplusplus-functions@sha256:b748a2d51c78df994ff93e0e26066d8193d61032ee2c21cad75264c1f2bb4c35`.
- Online image-manifest and GitHub signature checks passed again at 09:02 UTC.
  Both exact public images were downloaded successfully to the staging VPS.
  These facts are artifact provenance, **not deployment authorization**.
- Application Functions and migration source have no diff from the private
  bootstrap source `c24f8ecadbe49d353965a0e9b457ebcd3cfca287`.
  Compiled registry image compatibility passed the separate native disposable
  eight-service rehearsal below; live acceptance is still required.

The earlier 15-minute automated release-request envelope has expired. Do not
replay it, change its timestamp or treat a non-authorizing observer result as a
deployment permit. A manual launch needs fresh, explicitly recorded owner
approval of these exact digests, configuration and routing, separate from the
automated protocol. If that change in authorization procedure is not approved,
obtain fresh protected-workflow evidence instead. Automation stays disabled.

## Prepared configuration and rollback boundary

`scripts/staging-manual-first-release.mjs` prepares configuration only. It checks
the exact existing isolated model and verifies the public anon JWT's signature,
role and expiry in memory. It does not print credentials or deploy services.

The proposed changes are restricted to `srv1207055`:

1. Replace only the private Functions container's image with the exact published
   digest, retaining all its staging-only settings and restrictions.
2. Bind the existing API gateway only to `127.0.0.1:54331`.
3. Add frontend project/container/internal network `barber-staging-frontend`,
   bound only to `127.0.0.1:18080`. UID 101, read-only root/configuration,
   capabilities dropped, no-new-privileges, bounded CPU/memory/processes/logs.
4. Keep database, Auth, Storage, Realtime, Mailpit, all three persistent volumes,
   original bootstrap configuration and all existing unrelated services intact.
   No reset, reseed or migration is proposed.

Candidate configuration belongs under `/opt/barber-staging/manual-first-release`
and must be exclusive/root-owned; preserve the original private Compose model
for rollback. That directory and deployment operator are not yet installed.
Rollback restores the original Functions/gateway definitions and stops only
the new labelled frontend. It must not downgrade or restore over the database.
Public cutover must retain the old tunnel/DNS values for a separate routing
rollback. Do not run generic `compose down`, delete bootstrap markers, or invoke
the historical Mac deployment scripts against the VPS.

## Completed rehearsals and fresh recovery

The native no-network/no-port frontend rehearsal passed: exact image/template
identity, release/runtime values, SPA response, health, CSP, noindex, no-store,
nosniff, frame denial and UID 101. Existing service identities were unchanged;
only the labelled disposable frontend container and its scratch config were
removed. This is not browser or public-ingress acceptance.

Fresh backup: `staging-20261008T091500Z-be276ae2`, 1,188,328 encrypted bytes,
SHA-256 `d491407ad12e44ebd0d7dd11a8880e7a0bb333c2c311b608b6fd9d7c5cb701d0`.
The reviewed refresh mode read the existing Vault recovery probe without
creating, changing or deleting secrets. It verified image/configuration/mount/
network ownership, quiesced only the eight private services, captured the DB,
Storage and Vault/config state, encrypted it to the existing owner recipient,
and resumed those same services before publishing the manifest.

The Mac copy under `/Users/malabdullah/BarberBackups/staging/<backup-id>` passed
size/hash and full authenticated decryption. The decryption identity stayed on
the Mac. The prior October 5 backup remains retained.

An eight-service restore into **new disposable volumes** passed Auth, RLS,
Vault decryption, Storage bytes/content types/xattrs, sink-only SMTP, gateway
boundaries, Functions signatures/encrypted Flow/outbound denial, and Realtime
delivery/cross-tenant denial. Source counts: six synthetic Auth users, two
branches, two Storage objects, four migrations. No live volume was overwritten.
Only the labelled restore resources were removed after success. Receipt:
`/opt/barber-staging/supabase/restore-staging-20261008T091500Z-be276ae2.json`.

Frozen public operator bundle: `/root/barber-manual-release.TeZmqs`, 20 files.
Each file was checksum-verified before freezing as root-owned read-only source.
Capture SHA-256: `c05d1245170c5acc78d1202393c1b1b886701aa75111c869b6ab8d835b83e7aa`.
Restore SHA-256: `8f07ee6108be94f3b4a795d0d0418e210f5dca47a32198d2ce8cf64d87766bd1`.
Frontend probe SHA-256: `957aa785aa9e459d19cc0c360bbca4125856e6f81adb032ad5182d7d5a377d98`.
Manual model SHA-256: `44401a0f4c7b9723a7d49055c79150f1125652793b25d6cd9a4d83b5ac8d23d0`.

The separate published-Functions rehearsal also passed against fresh disposable
restore volumes, using the same full-stack checks and checking the compiled
manifest's exact source commit. It changed only the clone's Functions image,
never the live model. This is candidate compatibility evidence, distinct from
the exact-image backup restore above. Its receipt uses a separate filename:
`/opt/barber-staging/supabase/candidate-rehearsal-staging-20261008T091500Z-be276ae2.json`.
Frozen source: `/root/barber-candidate-release.65bZa6`; candidate-enabled restore
SHA-256 `01731d19dc76650723ff85f2894fb1a0e27ccae74f8c656985ee5ad3dbe35c0f`.
All labelled disposable resources were cleaned up; the old restore receipt and
original frozen restore operator remain unchanged.

Local verification passed: full `npm run check`, 27 backup safety/recovery tests,
four manual configuration tests and `git diff --check`. Five local Playwright
journeys passed earlier in this preparation; they are not VPS browser evidence.

## Cloudflare read-only inventory

Current tunnel `barber-staging-mac`, ID
`26a265bd-d46f-4fe0-9f81-182b5670da8a`, is healthy with one Mac connector.
Its routes remain:

- `staging-barber.malabdullah.cloud` → `http://localhost:8080`.
- `supabase-staging.malabdullah.cloud` → `http://localhost:54321`.
- Catch-all: `http_status:404`.

Access application `ebd6beef-9faf-497a-b765-694aa8e3a39d` retains the owner-email
Allow policy and staging Service Auth policy, default deny otherwise. The two
Meta child-path wildcard destinations belong to this protected application,
not the bypass application.

Bypass application `9e8eafcd-8a13-4992-9efe-df0769f09a72` contains only
`/functions/v1/whatsapp-webhook` and `/functions/v1/whatsapp-flow-endpoint`.
The gateway/function checks still require signatures/secrets and exact paths.
Live HTTP tests must verify neighboring and encoded paths after any cutover.

A new, separate `barber-staging-vps` tunnel was created.
Tunnel identifier: `890d4536-b73b-47de-be24-f45a064a79f3`.
The owner explicitly approved tunnel creation, official connector installation
and private credential storage.
Connector `78c28201-aabe-433a-bcd4-cf1837ff65ef` is healthy on `srv1207055`,
Linux AMD64. No application, CIDR or private hostname routes were added.
No DNS, Access, firewall, Mac tunnel or production setting was changed.

Official Cloudflare 2026.10.0 binary, downloaded from its GitHub release, is
installed at `/opt/barber-staging-cloudflared/cloudflared`; its SHA-256 matches
the release asset digest:
`d33ff2d14475178d2012c2c56beba87389ac5ded27649519f198a7d3134a99db`.
The enabled `barber-staging-cloudflared.service` uses a dynamic non-root user,
empty capability sets, no-new-privileges, strict filesystem protections and
256 MiB/50% CPU/64-task limits. It is a persistent network connector, **not
deployment automation**. Automatic binary updates are disabled; future updates
must be verified and installed deliberately.

Credential: `/etc/barber-staging-cloudflared/tunnel-token`, root-owned 0600 in
a root-owned 0700 directory. Systemd passes a private credential-file path;
the token is not a process argument, shell-history entry, repository file or
log value. Its temporary Mac transfer copy and clipboard contents were cleared;
the protected VPS credential remains. Never print/copy it into the runbook.

Readiness returned HTTP 200 with four connections, no process restarts, and
metrics bound only to `127.0.0.1:20242`. Existing Docker container identity
fingerprint stayed `97496dffd167cc0e68ddd2ab9b1bd157682f1b98fa2b695f0a31c354fd9e7c08`.
The reviewed unit is `ops/staging-vps/barber-staging-cloudflared.service`, SHA-256
`c5d3e64e554a28b37b0f73c2fe1799019bc5e4a96501eac239ee0fdf43ff2397`.
`systemd-analyze verify` passed; its sandbox exposure assessment was 2.8 (OK),
which is an advisory hardening score, not a security certification.

Do not join the VPS to the old Mac tunnel: two different origins under the same
tunnel can produce mixed environments. Keep Access unchanged and cut over only
the two staging DNS records after exact release approval and origin tests.

## Acceptance still required

- Reviewed, source-bound manual operator/configuration and rollback procedure;
  fresh exact-release/authorization and staging-only routing approval.
- Permanent loopback origin health and actual deployment/rollback verification.
- Staging-only tunnel routes, DNS/TLS and authenticated plus
  unauthenticated boundary tests; no direct-origin bypass or exposed management.
- Live frontend browser/role journeys, security headers, cross-tenant/Storage/
  Realtime checks, bounded load/resource checks and owner acceptance.
- External Meta/OpenAI calls remain disabled with empty credentials/allowlists;
  sandbox-only launch scope needs explicit acceptance. Synthetic security tests
  are not real-provider integration tests. No automatic backups or deployment
  timers are claimed complete.

Auth retains its documented version-match finding/downstream patch review.
Realtime's restricted synthetic-staging exception is not broadened or renewed;
its review deadline remains October 18, 2026 at 00:00 UTC. Retain no external
credentials or egress. The approved two-core VPS is for initial tests, not an
unlimited capacity claim. Env3 is not complete until remaining gates pass.

Reference: [Cloudflare's official remote-tunnel setup](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel/).

## Approved execution and private-origin recovery — October 8

The owner explicitly approved deploying release `6217cb3` from this exact plan
and moving only the two staging hostnames to the VPS. Access remains private;
automation and external AI/WhatsApp calls remain disabled; no database reset.

The first one-shot attempt updated only Functions/gateway and added the isolated
frontend. Docker on this host retained requested loopback port bindings in
HostConfig but did not publish them from internal-only networks. Loopback health
failed before routing changes. The operator restored the original Functions and
gateway and stopped the new frontend, preserving all configuration and receipts.
The frontend subsequently passed a diagnostic health check on its private IP.

The reviewed recovery operator keeps both networks internal and removes the
ineffective port mappings. It changes only the Functions image and frontend
configuration. It verifies existing non-target container identities against the
first attempt, exact configuration/template/image identities, migration hashes,
fresh backup and both successful restore receipts before mutation. It preserves
the first attempt's files rather than deleting markers or replaying bootstrap.
All preflight checks passed after correcting a source-file checksum mistakenly
used as a deployed-configuration checksum; the actual configuration hash matches
both `prepared.json` and the first attempt's `started.json`:
`15016fbbc08ce25c311783227f4b039288e4b6ed1cd584d6188605a32ef5da5d`.

Recovery operator: `scripts/resume-manual-staging-first-release.mjs`, frozen as
`/root/barber-manual-release.TeZmqs/scripts/resume-manual-staging-first-release-v3.mjs`,
SHA-256 `e002af4b4dfe5de199acb1880527869f1fde2e80d5c3030d4e4dff6f8e0252ae`.
Original one-shot operator SHA-256:
`73ea4447d90c2d490466099a80f785b4d551dcfaa1194d75039bfb2166b73395`.

The recovery completed successfully. Exact approved frontend and Functions
images are running, with zero published ports and no non-target container
changes. Receipt: `/opt/barber-staging/manual-first-release/origin-verified.json`.
Candidate files: `backend.private-origin.json`, `frontend.private-origin.json`;
attempt record: `private-origin-started.json`. These are root-private and must
not be printed or committed. Do not rerun either one-shot operator against the
completed markers.

Verified host-to-private-bridge origins:

- Frontend: `http://172.22.0.2:8080`.
- API gateway: `http://172.21.0.5:8000`.

Frontend health/runtime identity/noindex and Auth health passed. A synthetic
barber login passed; own-branch access returned one row and the other tenant
returned none. Unsigned POSTs to both exact Meta endpoints returned 401.
These are private-origin checks, not public ingress or browser acceptance.
Docker bridge addresses are not pinned: after any container/network recreation,
inspect ownership, network isolation and new addresses, validate health and
update only these tunnel origins before declaring service restored. Never open
host ports or attach these containers to an external network to work around it.

Cloudflare's create-route form rejected the existing frontend DNS record. A
temporary edit of that CNAME to the new tunnel did not resolve the conflict, so
it was restored and the UI verified the original Mac tunnel target. Both staging
DNS records remain proxied/Auto pointing to
`26a265bd-d46f-4fe0-9f81-182b5670da8a.cfargotunnel.com`; all other records and
Access rules are unchanged. Frontend DNS record ID:
`d5da0b4152457c663d41b22e745fa111`. No successful new tunnel route is claimed.
The owner has been asked for the additional delete-and-recreate action on only
these two DNS records. Retain the old Mac routes/tunnel for routing rollback.

The existing Mac Access service-token file was verified present with private
permissions and both required fields, without displaying credentials. Public
boundary and browser tests can use it in memory after cutover. No credential
needs to be pasted into chat.

Post-operator local verification: full `npm run check`, four manual configuration
tests and `git diff --check` passed. Existing bundle-size/dynamic-import warnings
remain non-blocking; this is not live browser evidence. Direct public TCP/HTTP
probes to staging ports 18080 and 54331 timed out instead of reaching either
application (consistent with zero published ports and provider firewall policy).

## DNS cutover completed; acceptance blocker found

The owner explicitly approved deleting and recreating only the two staging DNS
records. Both were replaced successfully through the new tunnel route form;
both are proxied/Auto and point to
`890d4536-b73b-47de-be24-f45a064a79f3.cfargotunnel.com`.
The new tunnel has exactly the two application routes to the private origins
above and a `http_status:404` catch-all. All other DNS records, Access policies,
old Mac tunnel/routes and production are unchanged. The old DNS values above
remain the rollback targets; the removed record identities cannot be restored,
but equivalent DNS records can be recreated or edited using those retained values.

See [live acceptance and resolved login defect](staging-live-acceptance.md).
This is the manual, synthetic-only sandbox scope, not production or fully
automated operational acceptance. Do not generate a production-promotable
accepted manifest from this restricted result.
