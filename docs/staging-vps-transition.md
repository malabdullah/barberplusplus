# VPS staging transition — preparation, not deployment acceptance

Updated 2026-09-30. This document supersedes the Mac hosting target in the older
staging runbooks; those describe the retained legacy implementation, not the
completed VPS target. No production resources are part of this transition.

October 5 update: the owner-approved permanent **private backend** is now running
and its complete eight-service backup/restore passed. The September observations
below are historical. Current resources and remaining release gates are recorded
in [private bootstrap execution](staging-private-bootstrap-execution.md).

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
   pinned Mailpit sink. WhatsApp and OpenAI credentials and recipient
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
   Compiled function packaging and local offline Edge Runtime checks are now
   implemented (see item 7); actual VPS/Envoy checks remain deployment gates.
7. Added a commit-addressed, secret-excluding source packager and a digest-pinned
   ESZIP function image. All eight real workers passed local offline startup,
   authentication boundaries and encrypted Flow ping/tamper checks. Deployment
   must add `compose.functions-image.yml` and use the compiled-only validator;
   the old source-mounted layer alone cannot run the new main service.

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
  function-image publication and rollback wiring must
  be implemented and reviewed before switching the workflow. Local compiled
  runtime compatibility passes; AMD64/VPS/Envoy checks remain. Do not merely
  relabel the runner or merge the Mac workflow as a VPS solution.
- Independently generate staging DB/Auth/JWT/Vault/Storage/Function credentials.
  No production secrets or data may be copied. The validated migration baseline
  remains unchanged and has not been applied on the VPS.
- Complete component security review and full-stack compatibility testing.
  On September 29, upstream released standard Postgres `17.11.0.002`.
  The staging overlay now independently pins its immutable index digest;
  local AMD64 startup, extension inventory and a SQL query pass (details below).
  This resolves image availability, not full-stack security or acceptance.
  Fresh application migration replay, Auth/Storage integration, image scanning,
  VPS-native execution and restore remain gates. No database engine was changed.
- Deploy and verify the prepared sink-only SMTP service with Auth, add dedicated
  Meta test IDs/secrets and Flow keys, and a budget/rate-limited OpenAI key. Keep outbound integrations
  disabled until their restrictions pass tests.
- Configure an isolated VPS tunnel/origin with no direct-origin bypass; cut over
  only the two staging DNS records after service health is verified.
- Complete encrypted off-device backups and a restore rehearsal. Same-host
  legacy archives do not satisfy this gate. The owner selected the Mac folder
  `/Users/malabdullah/BarberBackups/staging`; private destination directories are
  created. Encryption, verified SSH transfer and synthetic-file recovery now
  pass. The owner confirmed saving the recovery key in Apple Passwords and
  seeing the entry on another trusted device. The saved-key decryption test
  passed, with a matching private synthetic-fixture receipt verified on
  2026-09-28. Real DB/Storage/config capture and a full stack restore remain
  open. See `staging-backups.md` for evidence and limits.
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

## September 30 continuation

- With explicit owner approval, replaced the stale SSH source in Hostinger
  staging firewall `367995` with the owner's current single IPv4 `/32` and
  synchronized it. TCP 22 remains single-source; 80/443 and default-drop rules
  were unchanged. Do not store the owner's IP in this public runbook.
- Authenticated SSH again verified `srv1207055`, healthy Dokploy, 59 GB free,
  and no `/opt/barber-staging/supabase` directory. Existing n8n/Ollama services
  were preserved. The loopback-only Dokploy SSH tunnel was restored.
- GitHub CI run `36417742224` passed for committed baseline
  `fe0b3594dce4d08d516bbbd46de0a710ddb4e942`. That result does not certify
  subsequent September 30 edits.
- Standard PostgreSQL candidate: `supabase/postgres:17.11.0.002`, source commit
  `b36165476f28c34448acbcc712a05d26213183ed`. Source declares PostgreSQL 17.11;
  registry index digest is
  `sha256:0450166354dc9c1d25f0322ac8b580774d4fb0184d2b087f6e4fe9499c66cf53`.
  AMD64 manifest:
  `sha256:4bfbe2e6d7909bd386b1b774683899deb12efa04a3eebaa141f164ffd04ada1d`.
- The opt-in `npm run test:staging-postgres -- linux/amd64` probe passed locally
  using that exact image. It verifies initialization, server version 170011,
  availability of pg_cron, pg_net, pgcrypto, pgtap, supabase_vault and uuid-ossp,
  and a transactional pgcrypto query. No network, published ports, host mounts,
  real data or real credentials enter the probe. Its container and in-memory
  data are removed afterward. The image remains cached for repeatable testing.
  An initial harness failure was corrected: mounting an empty tmpfs over
  `/etc/postgresql-custom` hid packaged configuration. The final probe retains
  those files in its disposable container layer. This is not full-stack replay.
- The rendered upstream/VPS overlay passes the topology validator, which now
  rejects the old DB version, mutable patch tag, changed digest and OrioleDB
  substitution. Local `npm run check` and all five browser journeys passed;
  browser evidence uses the existing local synthetic DB, not the patched probe.
- Dedicated Meta app `Barber++ Staging Messaging`, ID `1628853515549372`, is
  linked to portfolio `1554900579775003`. Test WhatsApp account
  `3357959367924998` and test phone-number ID `1359666910563890` were created.
  The owner verified their test recipient and generated a temporary token.
  One Meta dashboard Hello World message was reported delivered. Billing showed
  a test account, no payment method and $0.00 current balance despite a billable
  flag in the delivery event; no additional sends or billing changes were made.
  No token or recipient identifier is saved here. No Meta credential has been
  installed on the VPS, and this is not an application/webhook/Flow E2E result.
- Dokploy's owner profile currently reports no API keys. Deployment automation
  still needs a least-privilege credential setup; creating a separate member
  was deferred following the owner's question. Manual preparation can use the
  existing login. No new member or owner-wide key was generated. The staging
  project remains empty.

### Dependency security and core rehearsal

- Patched Vitest from 3.2.7 to 4.1.11 and the transitive brace-expansion from
  5.0.9 to 5.0.12. Refreshed npm and Deno lockfiles; no runtime application
  dependency version changed. `npm audit` and the clean Docker `npm ci`
  reported zero known vulnerabilities. This is not a container-image scan.
- `npm run check`, all five local Playwright journeys, migration-name checks,
  and function packaging tests passed. Frozen Deno checks remain enabled.
- Rebuilt the local frontend image; health, release injection, CSP/security
  headers, cache policy, UID 101, rendered staging banner and robots directives
  passed. The probe exposed only an ephemeral loopback port and blocked all
  external browser requests. Its container was removed afterward. This image
  is a local test artifact, not a published or accepted release.
- Added `npm run test:staging-supabase-core -- <verified-upstream-directory>
  linux/amd64`. It renders and validates the proposed VPS overlay, then derives
  a **local-only six-service** rehearsal: DB, Auth, REST, Storage, imgproxy and
  Mailpit. It resolves and records immutable image references, generates new
  synthetic credentials in memory, and uses a unique internal-only network,
  no published ports and uniquely named disposable data/config/Storage volumes.
  Only the upstream SQL initialization files are mounted from the host, read-only.
  Cleanup checks ownership labels; unrelated containers and volumes are preserved.
- The Linux AMD64 core rehearsal passed PostgreSQL 17.11 initialization, all
  four application migrations, local synthetic seed, all 32 pgTAP security
  assertions, Auth login, Auth invitation delivered only to the private mail
  sink, private Storage upload/download and anonymous denial. The rehearsal is
  also wired into application CI; the remote result must be checked separately.
  Docker Desktop's `/host_mnt` path mapping required an exact-path adjustment
  to the harness. It did not require weakening the proposed VPS isolation.
- Cron execution is disabled throughout the disposable rehearsal. One historical
  migration contains a production URL before a later migration replaces it;
  neither that intermediate job nor any other outbound job may execute during
  a fresh VPS replay. Keep integrations quarantined and cron inactive until the
  complete replay and environment-specific Vault configuration are verified.
  The actual initial VPS overlay now also enforces `cron.launch_active_jobs=off`;
  its validator rejects missing or enabled cron settings (54 topology tests pass).
- `supabase/seed.sql` explicitly permits **local/CI only** and uses published
  test passwords. Do not apply it verbatim on the VPS. A separate staging
  fixture procedure with newly generated passwords is still required.
- This does not certify Realtime, Studio, Envoy, pooler, compiled Functions,
  full-stack schema drift/restore, VPS-native execution, public routing, load
  or release acceptance. Existing local browser E2E results still use the
  retained development database, not this disposable core.
- Separate code-review pass: reviewed secret flow, local Docker restriction,
  exact read-only SQL mounts, no-port/internal-network enforcement, image identity,
  cleanup ownership checks, migration/seed scope and CI placement. Corrected the
  Docker Desktop mount mapping and added the cron quarantine above. This is an
  agent code review, not independent human review or owner release approval.
- Trivy 0.74.0 scanned the exact AMD64 PostgreSQL image on September 30 with
  telemetry disabled. Its binary checksum was verified against the official
  release asset. The high/critical report contains 20 HIGH findings, all in the
  Go 1.26.1 standard-library version recorded in `/usr/local/bin/gosu`; no
  CRITICAL findings were reported. These are version matches, not proven
  reachable vulnerabilities. Follow-up `govulncheck` 1.8.0 binary/symbol analysis
  of the extracted AMD64 helper returned exit 3 and flagged 28 standard-library
  advisories (including severities outside the Trivy filter). It did **not** clear
  the findings. Binary analysis alone does not prove remote exploitability.
  Do not silently suppress them or
  describe the image as vulnerability-free. Nix-packaged components also need
  coverage review; a successful scanner exit alone is not approval.
  Helper SHA-256:
  `d34df779907c05a8d2e67cc088095bba4dd9212156bebf747554019705dfd34b`;
  embedded source: gosu `6456aaa0f3c854d199d0f037f068eb97515b7513`, Go 1.26.1.
  Trivy JSON report SHA-256:
  `6541ecef0345b4a39ae9ebbca75eff3c613d51ce8b147aaa29d559d2c4910686`.
  No permanent scanner installation, Docker account, API key or new Dokploy
  member was created. Temporary analysis tools/reports remain on the owner Mac.
- The owner subsequently approved **preparation only** of a staging-only derived
  PostgreSQL image. The local candidate and evidence are below. This is not
  permission to publish, merge, deploy, or grant a vulnerability exception.

### Staging-only helper patch (September 30)

`ops/staging-vps/Dockerfile.postgres` retains the exact PostgreSQL base above.
It rebuilds gosu 1.19 from the same source commit, using digest-pinned Go 1.27.1
and unchanged checksummed Go modules. The downloaded source archive is also
SHA-256 pinned. No credentials or repository files enter the empty build context.
The final image retains upstream runtime configuration and every base layer;
the only added regular file is `/usr/local/bin/gosu`, root-owned mode 0755.
The layer also contains its three parent directory entries; no database binary,
extension, configuration, entrypoint or OS package was replaced.

Local Linux AMD64 evidence (not registry publication):

- Image manifest / local single-platform ID:
  `sha256:b8aebc0a7bdcfd3eadc557f0d19999ee5f5d4a29590e03ba34d90acf783cbd92`.
- Image config digest:
  `sha256:eda7a340ce152feebe93910bdf326ce86e50600cc7602f27784c7767528637f8`.
  Docker's classic store and containerd store can expose different kinds of
  local image IDs; obtain the ID with `docker image inspect`, not build-log guessing.
- Patched helper SHA-256:
  `867f368c2279a8f2cbf22dd987d1bd4fd65f312696f0d63fe09f607b930a1790`.
  `go version -m` confirms Go 1.27.1, Linux AMD64, CGO disabled, and the same
  moby/sys/user 0.1.0 and x/sys 0.1.0 dependencies as the original helper.
- Trivy 0.74.0 HIGH/CRITICAL rescan: **zero findings** in its recognized Alpine,
  Node, Cargo-lock and Go-binary targets, versus 20 HIGH in the original helper.
  JSON report SHA-256:
  `6488b69d0f51aabf65b951a2e08a2895abe85190176f8eb67ed3c37f37489492`.
  `govulncheck` 1.8.0 binary/symbol analysis: **no vulnerabilities found**, exit 0.
  Neither result certifies complete Nix package coverage or the other stack images.
- Contract probe passed initialization, PostgreSQL 17.11, required extensions,
  pgcrypto, named/numeric user and group switching, missing-user rejection and
  denial of an unprivileged attempt to become root.
- The patched six-service core passed all four migrations, 32 pgTAP assertions,
  synthetic login/invite to Mailpit, private Storage round-trip and anonymous
  denial. Cron stayed disabled, Vault empty, network internal-only and ports
  unpublished. Probe containers, network and synthetic volumes were removed.
- `npm run check` and migration-name checks passed. The new candidate validator
  adds 16 tests, for 70 combined staging topology/candidate tests. It rejects
  mutable identifiers, other platforms, changed base layers/runtime settings,
  incorrect patch provenance and extra layers. The candidate option exists only
  in local probes; the actual VPS Compose image allowlist is unchanged.
- All five local Playwright journeys passed on a sequential rerun. The initial
  run, concurrent with another build in the same directory, missed the manager's
  branch card; build interference is suspected, not proven. Browser tests use
  the retained local development database, not the patched disposable core.
- Separate agent code review checked immutable inputs, unchanged runtime/base,
  exact helper payload, candidate opt-in isolation, cleanup guards and no-push CI.
  This is not independent human review or owner release approval.

Reproduce locally (no publish or deployment):

```sh
base="$(node --input-type=module -e 'import { POSTGRES_IMAGE } from "./scripts/check-vps-compose.mjs"; console.log(POSTGRES_IMAGE)')"
docker pull --platform linux/amd64 "$base"
docker build --provenance=false --platform linux/amd64 \
  --tag barber-staging-postgres:gosu-patch-local - < ops/staging-vps/Dockerfile.postgres
candidate="$(docker image inspect --format '{{.Id}}' barber-staging-postgres:gosu-patch-local)"
npm run test:staging-postgres -- linux/amd64 "$candidate"
npm run test:staging-supabase-core -- /path/to/verified/upstream linux/amd64 "$candidate"
```

`--provenance=false` is for this local single-platform rehearsal only, avoiding
an extra attestation index that some local scanner/image-ID paths cannot address.
Any future registry publication must produce and record build provenance/SBOM,
verify the pushed digest and rerun the acceptance gates on that exact artifact.
CI now builds this candidate without registry credentials and runs both probes.
The previous run `36705580765` failed during image preparation; its other four
jobs passed. A passing replacement run is required, not inferred from local tests.

Maintenance obligation: keep this patch small and staging-only; pin and review
every Go/source/base update, repeat layer inspection, vulnerability scans and
compatibility probes, and retire the override when an upstream image supplies
a suitably patched helper. Do not automatically roll back to the vulnerable
base or suppress findings. Full-stack compatibility, Nix coverage review,
VPS fixture/secrets setup, backup/restore, routing, load and owner release approval
remain open. **Deployment remains NO-GO.**

Security references: [Vitest advisory](https://github.com/vitest-dev/vitest/security/advisories/GHSA-82fw-gwwq-j7x9),
[brace-expansion advisories](https://github.com/juliangruber/brace-expansion/security/advisories).

New version evidence:
[17.11.0.002 release](https://github.com/supabase/postgres/releases/tag/17.11.0.002),
[exact source version declaration](https://github.com/supabase/postgres/blob/b36165476f28c34448acbcc712a05d26213183ed/nix/config.nix).

### October 4 continuation — local recovery passes, live acceptance still blocked

- Owner-approved staging SSH `/32` replacement was saved and synchronized on
  Hostinger firewall `367995`. SSH to `srv1207055` succeeded; Dokploy and its
  dependencies were healthy. Production and all other provider rules were left
  unchanged. `/opt/barber-staging/supabase` was still absent: no live stack exists
  at the planned target yet. The original user worktrees were preserved.
- New separate fixture preparation generates five unique random passwords in
  memory. Synthetic entity IDs/data remain deterministic; the public development
  seed is unchanged. The staging template refuses nonempty Auth, Vault, Storage
  or application tables and requires cron disabled. A Vault-only negative test
  and duplicate-seed test require the exact guard error, not any SQL failure.
  This prepares SQL only; it is not a live installer or baseline authorization.
- The disposable six-service AMD64 rehearsal passed all four migrations,
  32 pgTAP assertions, random fixtures, Auth login/invite into Mailpit, Storage
  upload/download, and explicit anonymous denial (not a server error).
- Recovery now encrypts DB dump, Storage archive, the separate DB-config/root-key
  archive and runtime configuration together. Fresh labeled volumes recover
  accounts, Vault decryption, cross-tenant RLS and private file content/type.
  GNU tar preserves Storage xattrs; the earlier plain-copy attempt reproduced
  HTTP 500. Missing root-key data had independently prevented Vault decryption.
  The final corrected rehearsal and ciphertext-tampering rejection passed.
  Temporary identities and only the labeled probe resources were removed.
- DOMPurify was patched from 3.4.13 to 3.4.16 after a new npm advisory. The
  application uses string sanitization, not the advisory's IN_PLACE usage; this
  is maintenance, not a claim of a proven application exploit. The template
  sanitization regression test and locked-install audit (zero findings) passed.
- Final `npm run check` passed: 14 function tests, 7 frontend unit tests, CI/CD
  helper checks, 4 release tests, 77 staging topology/candidate/fixture/recovery
  tests, 20 gateway tests, build and domain checks. Migration names and all five
  local Playwright journeys passed. Known chunk-size/dynamic-import build warnings
  remain. Browser journeys use the existing local development DB, not the VPS.
- Local AMD64 frontend Docker build and network-disabled runtime probe passed
  health, SPA fallback, synthetic runtime config, security headers, no-store and
  noindex. No registry publication or release acceptance was performed.
- Separate agent review identified and corrected permissive denial/duplicate
  tests, archive-helper cleanup and empty-input test weaknesses. This is not
  independent human review or owner release approval.
- Eight pinned component scans and three newer-candidate scans retain unresolved
  HIGH/CRITICAL findings. See [security inventory](staging-component-security-2026-10-04.md)
  for identities, scope limits and compatibility cautions. No silent upgrades or
  security exceptions were applied.

Env 4 runs in its own worktree on `codex/env4-cicd`. Its Linux/VPS workflow is
deliberately fail-closed. The proposed constrained deployment broker, dedicated
project-scoped Dokploy identity, unprivileged runner, GHCR pull identity, first
empty-stack bootstrap and real VPS backup/recovery remain unimplemented/gated.
Local synthetic recovery cannot satisfy a live backup receipt or release gate.
Security remediation, full-stack tests, live secrets/integrations, routing,
outbound controls, load gate and owner-specific release approval remain open.
**Env 3 and Env 4 are both NOT COMPLETE; deployment remains NO-GO.**

### October 4 continuation — read-only VPS broker installed

- The owner approved GitHub-hosted CI plus a constrained server-side deployment
  service, **not a GitHub self-hosted runner on this VPS**. The public personal
  repository cannot use runner labels as a pull-request isolation boundary.
  This supersedes the unprivileged-runner proposal immediately above; the
  existing Mac runner was not changed in this slice.
- The dedicated Dokploy invitation was accepted. The new account was visibly
  verified as an active **Member**, not an owner/admin. All global toggles and
  project/environment/service assignments remain off. No API key was created.
  The empty `Barber Staging` project still has zero services. Password creation
  was performed by the owner, not the agent. Fine-grained custom roles require
  Dokploy Enterprise; do not claim free Member permissions are action-specific.
- Installed the [read-only broker foundation](../ops/staging-vps/broker/README.md)
  on `srv1207055`: root-owned executable under
  `/usr/local/libexec/barber-staging-broker/`, socket/service unit files under
  `/etc/systemd/system/`, and `/run/barber-staging-broker.sock` with mode
  `0660 root:barber-staging-release`. The socket is enabled and active; the
  non-root service starts on demand and exits after inactivity.
- Created locked, non-login system users `barber-staging-broker` and
  `barber-staging-deploy`. Neither belongs to Docker, sudo, or the socket group.
  The deployment user's home is private. No credential, polling timer, HTTP
  listener, repository checkout or shell-command executor is installed.
- All six public installer/code/unit files were frozen into root-owned protected
  directories and SHA-256 compared with the reviewed local files before
  execution. Existing installation paths, identities, systemd units/drop-ins
  and unsafe source/destination ancestors are refused. Effective sandbox
  properties and exact installed unit bytes are checked before activation.
- The first activation guard stopped safely because plain `systemctl show`
  omitted empty properties. Inspection confirmed the socket remained disabled
  and both units inactive. The checker now uses `show --all`, covered by a
  regression test. A new frozen/checksummed copy passed all checks before
  the separate socket activation; no guard was bypassed.
- Thirteen broker/installer tests passed locally and on the VPS. The live
  administrator probe passed socket/file ownership, locked identities, denied
  nonmember connections, real Linux peer rejection, duplicate/extra-field and
  oversized request rejection, non-root process UID, zero capability sets,
  no-new-privileges and a separate network namespace. Every mutating operation
  returned `OPERATION_DISABLED`; status reports `automationReady=false` and
  `liveStackVerified=false`. These are capability statements, not stack health.
- Dokploy health still returned `ok: true`; the existing Dokploy, n8n, database,
  Redis, Ollama and Traefik containers remained running. The planned
  `/opt/barber-staging/supabase` path is still absent. No application deployment,
  production action, DNS/firewall change, permission grant or secret access
  occurred in this slice.

The signed-release verifier, constrained write adapters, safe component pins,
first live bootstrap, real VPS backup/recovery, isolated integrations, routing,
load/E2E acceptance and owner release approval remain outstanding. The read-only
foundation does not advance any of those gates or enable the deployment workflow.
**Env 3/4 remain NOT COMPLETE and application deployment remains NO-GO.**
