# Staging component security inventory — 2026-10-04

## Local remediation update — not deployment acceptance

The following work does not change Compose pins, grant a vulnerability exception,
publish images or authorize deployment. All candidate runtime tests use new local
synthetic volumes and internal-only networks. Production is unchanged.

Non-secret final scan reports and a SHA-256 index are preserved privately at
`/Users/malabdullah/BarberBackups/staging/validation-2026-10-04-7giejf/` (12
scan reports plus the sanitized full-stack test output/receipt; directory
0700/files 0600). These are local candidate evidence, not
remote attestations or deployment approval. Earlier temporary paths below remain
historical provenance; the preserved copy avoids relying only on `/private/tmp`.

Final separate code-review pass checked the downstream recipes, immutable local
candidate selection, isolated gateway/client test, strict Storage denial predicate
and narrowly allowlisted recovery role restoration. It is an AI code review,
not independent human approval. Final `npm run check`, 107 staging/unit safety
checks, migration-name check and diff whitespace check passed. Two stored Go
patches have exact-file whitespace attributes allowing their required diff
context-space/tab prefix; no application/security check is disabled. A scoped
scan of all 46 changed/new files found no secrets. At that checkpoint browser
acceptance was withheld because the development REST timing defect was present;
the later update below records its verified fix. Fresh GitHub CI and
release-specific owner approval remain separate gates. No branch protection,
workflow approval or runtime gate was waived.

### Storage 1.79.31 downstream runtime candidate

`ops/staging-vps/Dockerfile.storage-candidate` retains the compiled application,
migrations and Watt configuration from official AMD64 manifest
`supabase/storage-api@sha256:13cdccea43f23d848f050eba0d4f3ccdf02a7aca93d4f43268438de95549ef74`.
The upstream package manifests were verified byte-for-byte against tag v1.79.31,
source commit `eccef5e70a67fb4030e0646e5e22602c94f568bc`.
This comparison is not a signed source-to-binary attestation.

The reviewed dependency patch uses Fastify 5.12.2, Undici 7.29.1 and narrowly
scoped same-major security fixes for affected transitive dependencies. Safe
newer versions and the exact pg-boss Git commit are preserved. Production native
dependencies rebuild against the same pinned Node 24.20.0/Alpine 3.24 base as the
runtime. Final runtime excludes npm/Yarn and compiler/Python tooling, and installs
OpenSSL libraries at exactly 3.5.9-r0. This is a maintained downstream image,
not an official Supabase release or a change to application source.

`scripts/prepare-staging-storage-candidate.mjs` reads only committed upstream
manifest blobs, checks their hashes, applies the retained lockfile patch, verifies
the resulting hashes and creates an exclusive new build directory. It does not
resolve dependencies, read checkout secrets or overwrite existing output.
The Docker context permits only the two manifests and Dockerfile.

Final local daemon-addressable OCI index:
`sha256:05ca80acbbe1fa533ca946fcd9aabbbea8065b86bfd1446e8350650ae1e6ea46`.
Selected AMD64 manifest reported by platform-aware Docker inspection:
`sha256:ffc760ae7a04b0790ba3988c31916a586790db88b66f53d7f307dfe297231613`.
These different identities are explicitly bound by the local probe; labels alone
are not trusted and mutable tags are not accepted.

Trivy 0.74.0 at `2026-10-04T09:55:56Z` reports **0 HIGH / 0 CRITICAL** in
18 Alpine and 883 Node packages, without suppression or ignore-unfixed flags.
Raw report SHA-256:
`6222bfe7df833cabd92787277a882eebc55dcef999ce71ef8a22827b732df00c`.
Evidence remains under `/private/tmp/barber-storage-source.wB7gXZ/` and is not
durable release evidence. Native addon/application-source coverage is separate.

The exact candidate passed the five-service AMD64 core and encrypted recovery
rehearsal: four migrations, 32 pgTAP assertions, randomized fixtures, duplicate
seed refusal, login, sink-only invitation, private upload/download, transformation
disabled, anonymous denial, archive tamper rejection and new-volume recovery of
Auth/RLS/Vault/Storage. A separate static code review found no actionable blocker;
that is not independent human review or release approval.

### Auth and Realtime

Auth's local downstream candidate updates gRPC/OpenSSL and adds a regression-tested
negative-length guard to vendored pgproto3/v2. The retained package version still
produces **1 HIGH / 0 CRITICAL** in the unsuppressed scan. It is not represented as
a clean scan; patch applicability review and reproducible source evidence remain
separate from compatibility. Both patched Auth and Storage together passed the
same isolated core/recovery rehearsal.

Realtime's exploratory supported OS update reduced the same-database scan from
137 HIGH / 3 CRITICAL to 78 HIGH / 0 CRITICAL, with 25 distinct remaining advisories.
No packages were removed in that result; application files remained unchanged.
The owner subsequently approved preparing a hardened staging-only profile with
unused AWS/admin tooling removed and evidence-backed applicability review. This
does **not** accept unresolved vulnerabilities or authorize live deployment.
The hardened candidate now reports **52 HIGH / 0 CRITICAL**, covering 119 Debian
packages and 12 distinct advisories. `ops/staging-vps/realtime-security/assessment.json`
retains each finding and its conditional disposition; it is explicitly
non-authorizing and is not a scanner suppression file. Some findings concern
absent components, others require the strict unprivileged/read-only profile,
and some remain vulnerable packages with no reviewed application path. Mitigated
is not patched. Erlang/Elixir and compiled Bun application coverage is not claimed.
The zero-HIGH raw gate remains unmet. Realtime is required by bookings,
notifications and agent conversations.

The final local reference is
`sha256:2ea7fb6d3211f8e627985e473329dc5bb1abbbdc810d02784847d0a82bbd092c`,
with AMD64 manifest
`sha256:78f25384ba6173d08f4dd7969989f5115d986cf4e8923f7906bf4fa00bfd1902`.
Native-library/pgdelta/profile checks passed. Full-stack startup uncovered an
AMD64-on-ARM emulation failure also reproduced in the unchanged upstream image;
the documented local-only JIT accommodation enabled the functional rehearsal.
The exact eight-service set then passed real gateway/Auth/REST/Storage/Functions
and Realtime booking-event/cross-tenant checks. A separate five-service encrypted
restore passed after preserving Realtime's narrowly allowlisted non-login role.
These results are not native-VPS, full eight-service recovery or security
acceptance. Realtime already uses supported Debian 13.7: another Debian 13
rebase would not remove the residual unfixed matches. Owner acceptance of the
specific restricted staging profile was explicitly granted on October 4 after
the risks and alternatives were explained. The exact scope, image/profile/report
hashes and initial October 18 review deadline are recorded in
`ops/staging-vps/realtime-security/owner-acceptance.json`. A separate disposable
native profile rehearsal now passes on `srv1207055`, without network access,
published ports or the ARM workaround. It verifies explicit unsafe-setting and
privilege rejection, absent optional tools, unchanged app bytes, pgdelta and
release evaluation. The receipt is
`ops/staging-vps/realtime-security/native-profile-evidence-2026-10-04.json`.
All probe containers were removed; only the image cache remains. Native full-stack
integration and release-specific approval remain outstanding; raw findings are
unchanged, and the actual staging stack has not been created.

### Frontend, Functions and REST follow-up

The frontend runtime applies supported Alpine package fixes while retaining the
pinned unprivileged Nginx base: libexpat 2.8.5-r0, libuuid 2.42.3-r1 and pcre2
10.49-r0. Exact local AMD64 manifest
`sha256:dab9e7d689ac99f089a5d74b4e119ddc81f72c7a3ccce22e0c41f16ae55512a2`
reports **0 HIGH / 0 CRITICAL** across 70 Alpine packages. A network-none local
container passed health, UID 101, staging runtime configuration/release, SPA
fallback, no-store, noindex and CSP/security-header assertions. It does not prove
live TLS, Cloudflare Access, browser journeys or accepted release provenance.

Fresh scans with explicit empty configuration/ignore files and a sanitized
scanner environment confirm Storage 0/0, Auth 1/0, database 0/0, Mailpit 0/0 and
Envoy 0/0 (HIGH/CRITICAL). Reports are under
`/private/tmp/barber-clean-runtime-scan.cUL4fY/`; OS-only scans do not certify all
embedded application languages. The old compiled Functions runtime remains
**66 HIGH / 6 CRITICAL**; upstream v1.77.4 still reports **56 HIGH / 4 CRITICAL**.
A minimal downstream Functions runtime now preserves the exact upstream v1.77.4
binary and ONNX libraries on pinned distroless Debian 13. The compiled AMD64
manifest `sha256:4304bfb208a54190aab7347dfe83c362efb7feb88f40ddd99d85c227b31e2c16`
reports **0 HIGH / 0 CRITICAL** across 14 OS packages. All eight workers, JWT/cron
denials, exact paths, CORS, Meta signatures, encrypted Flow round-trip and tamper
rejection pass in an offline synthetic rehearsal. Raw scan SHA-256:
`4c32c2ffbb49c284875a5ca0ba38dba06f6d827a3aad1c60cd5adfd9a3a6c12b`, at
`/private/tmp/barber-edge-scan.BO5Kyg/raw.json`. This does not certify compiled
Rust/Deno/V8/ONNX dependencies or authorize a deployment.

Repeated local browser tests exposed PostgREST's sporadic `PGRST303` JWT-issued-
in-the-future bug in the existing development v16.1 service (14/15 repeated
journeys passed, one manager journey failed). The official fix exists in 14.18
and 16.3; the staging-only candidate selector now uses official 14.18 AMD64
manifest `sha256:c847127074bd26e1b8d3f7c0e6e01e5346f4b85dd34f5d699fd230af960827c0`.
No JWT checks were weakened and no retries were added to hide the failure.
The scanner recognizes no OS/language package inventory for PostgREST: an empty
result is **no coverage**, not security clearance. See the upstream
[PostgREST changelog](https://github.com/PostgREST/postgrest/blob/main/CHANGELOG.md).

For the separate development/CI fix, verified CLI 2.116.0 source reads
`supabase/.temp/rest-version` with the exact text `v16.4`. A running database
causes `supabase start` to return early, so a normal project-scoped stop/start
is needed, without reset or `--no-backup`. On October 4 the owner explicitly
approved that local no-reset restart. It completed with identical before/after
DB and Storage volume identities, public/Auth-user/Storage-row fingerprints,
public/Auth/Storage schema fingerprint and file-storage content fingerprint.
The primary checkout and its ignored CLI-generated startup files were preserved.
Private comparison evidence: `/private/tmp/barber-local-rest-maintenance.f6jvx3`.
The vendor ECR AMD64/ARM64
16.4 manifests were verified as `bee9e1efe9d90d8f6be359f756e039dbb6e1972474bc271b7c49c5a495911a41`
and `c3638ac25258ede665db66a4052b6fd30db4f22789327dce84599409136da35f`.
The candidate staging REST 14.18 is separate from this local runtime fix.
The development startup/bootstrap scripts and browser CI now call
`scripts/prepare-local-service-pins.mjs`. Four tests cover exact/idempotent pinning,
preservation of conflicting overrides, CLI/PG compatibility and symlink refusal.
`npm run check` passes with this helper. The local development service now runs
the exact ARM64 16.4 image above. All five Playwright journeys passed three
consecutive repetitions (15/15, one worker, no added retries). No database reset,
JWT weakening, primary-checkout change or VPS/production restart occurred.
The 32 local pgTAP assertions, migration naming and schema-drift checks also pass.
This clears the local regression, not live staging acceptance. Upstream fix:
[PostgREST 16.3 release](https://github.com/PostgREST/postgrest/releases/tag/v16.3).

All component identities, dependency patches, full-stack integration, VPS load,
network boundaries and release-specific owner approval still need to be bound
to the final release. A passing local core rehearsal alone cannot establish them.

## Original inventory and subsequent upstream candidate review

**Unresolved; no full-stack acceptance or vulnerability exception.**
Trivy 0.74.0 scanned eight explicit Linux AMD64 manifests remotely, with a fresh
database updated `2026-10-04T01:47:20.093525258Z`. No images were executed by this
inventory, and no suppression, severity override or `ignore-unfixed` option was
used. Scanner exit zero means the scan completed, not that it found no issues.

| Component | Selected version | HIGH | CRITICAL |
| --- | --- | ---: | ---: |
| Studio | 2026.08.03-sha-022b374 | 446 | 19 |
| Envoy | v1.39.0 | 2 | 0 |
| Realtime | v2.102.3 | 152 | 7 |
| Postgres-meta | v0.96.6 | 108 | 7 |
| Supavisor | 2.9.5 | 934 | 29 |
| GoTrue/Auth | v2.189.0 | 47 | 1 |
| Storage | v1.60.4 | 127 | 1 |
| Imgproxy | v3.30.1 | 55 | 2 |

Counts are package/advisory occurrences, not distinct vulnerabilities or proven
exploitable paths. Windows-only, 32-bit and kernel-header matches need explicit
applicability review. Fixed-version metadata is not compatibility evidence.

Exact manifest identities (not the multi-platform index digests):

```text
supabase/studio@sha256:2616bb9ed337963fe27ce682b1783875083537d5fb54bfea4c399fb0c56ff03e
envoyproxy/envoy@sha256:f6e2f57b1bef8235083a2553b523508cf97d8991c893fd2aae3a94a6b21096a2
supabase/realtime@sha256:2cc87edf0db5cebf1f58c9a4116bb80a25ff764c8706b6802fa68d976e66e5d7
supabase/postgres-meta@sha256:b9edad6fff2d4fb991ecd57837dbe3f21d2efa0f0ccb186f6ccf0e2d57192fed
supabase/supavisor@sha256:4dd940610c0ef5c8284ef88a28530566d45b52f7d3de285497a67c169e00cec9
supabase/gotrue@sha256:0a8557cbe0fd53a067726fe656f79eb1b03a1ab3cdde4b59907ce5a1e1a202ab
supabase/storage-api@sha256:6f706c1184d97b081446527bb62a3193d3d47ad0daafcf738fd5c3e5a62aed97
darthsim/imgproxy@sha256:965c3782818766a477a056016e18f88f9a028bf68b39cb2316978945ac2c0492
```

Priority review: outdated Next.js in Studio, EOSL Debian 11 in Supavisor, Go
runtime/dependencies in Auth and Imgproxy, Node dependencies in Storage/meta,
and OpenSSL in Envoy. Realtime/Supavisor have OS-only scan coverage, not Erlang
application coverage. Envoy's OS scan does not certify statically linked C++
dependencies. Native codecs and Nix packages require separate review.

Temporary raw evidence: `/private/tmp/barber-component-scan.JSNFGY/` (individual
component JSON reports, scanner logs and index descriptors). The reviewed
inventory is preserved here; temporary raw reports may be cleaned by the OS.
Full structured `summary.json` SHA-256:
`ed03dbaf1adeb34e50037898891b4165115bd91f611a75ce4befb9b6d9a5c62e`.

This inventory excludes PostgREST, Mailpit, frontend, database patch and Functions
images. Previous scans of those artifacts do not imply current full coverage.
Next: select compatible patched candidates, review source advisories and
reachability, rescan exact manifests, rerun compatibility and recovery tests,
then obtain release-specific acceptance. Do not silently update the deployment
allowlist or treat a successful local smoke test as a security exception.

## Bounded newer-candidate review

Official `self-hosted/v0.8.2` resolves to commit
`564eab8ad7840b13324f68b1bfac074ef8d51c21`. Exactly three newer candidates were
scanned with the same methodology; none clears the gate:

| Candidate | HIGH | CRITICAL | Exact AMD64 digest |
| --- | ---: | ---: | --- |
| Envoy 1.39.1 | 2 | 0 | `sha256:be87c8b52663c1164a5bdf3c5419017a269cb3d8c74be1ec93638a71f1ffbd4b` |
| Auth 2.196.0 | 26 | 0 | `sha256:7e813221b93fbf54b515036438550e483bfaf057b9db52fe9bc1ce91c47e817e` |
| Storage 1.74.0 | 68 | 1 | `sha256:63da55733ce9d7592d860739acb94f0b6189d880b7565d247ee5b195be854db1` |

Envoy's remaining matches concern OpenSSL; Auth needs Go toolchain/dependency
and OpenSSL review; Storage retains the critical tar match plus other Node/OS
matches. New Studio, Realtime, meta, Supavisor and Imgproxy tags remain unscanned.
No candidate replaces a deployment pin in this change.

The [Envoy 1.39.1 release](https://github.com/envoyproxy/envoy/releases/tag/v1.39.1)
also fixes native Envoy issues, including RBAC path-parameter bypass, which the
OS-only scan did not detect. Its two OS findings are not its whole risk inventory.
Gateway normalization and exact public-path boundaries require regression tests.

Do not copy new upstream Compose wholesale: it still selects PostgreSQL
17.6.1.136, older than our separate 17.11-derived candidate. Review JWT-setting
removal, extension grants, gateway CORS/config, worker behavior, Auth changes and
Storage migrations before any selective upgrade. Primary evidence is the
[versioned Compose source](https://github.com/supabase/supabase/blob/564eab8ad7840b13324f68b1bfac074ef8d51c21/docker/docker-compose.yml)
and [changelog](https://github.com/supabase/supabase/blob/564eab8ad7840b13324f68b1bfac074ef8d51c21/docker/CHANGELOG.md).

Temporary candidate reports: `/private/tmp/barber-candidate-scan.emuuRK/`.
Structured summary SHA-256:
`583054585a6c90d152ae7c971af1f02033fde40d1682e98b40e9799b826b9499`.

## Envoy 1.39.2 candidate — isolated verification, not pin promotion

An additional upstream release was found during primary-source review:
[Envoy 1.39.2](https://github.com/envoyproxy/envoy/releases/tag/v1.39.2), released
October 1. The official AMD64 candidate is
`envoyproxy/envoy@sha256:43b69cf424922cd5d1086cc019dc89197e58d58deac89d36b3c8b67f1a9e8523`.
No derived image was necessary and no deployed/Compose pin was changed.

- Trivy 0.74.0 with database updated `2026-10-04T01:47:20.093525258Z` completed
  a fresh exact-manifest scan at `2026-10-04T08:05:12Z`: **0 HIGH, 0 CRITICAL**.
  Coverage was 104 Ubuntu 22.04 packages and zero language-specific files.
  This is not a complete native-code audit, exploitability claim or full-stack
  acceptance. No suppression or ignore-unfixed option was used.
- Both `libssl3:amd64` and `openssl` report `3.0.2-0ubuntu1.30`, the Jammy fix
  for [CVE-2026-84782](https://ubuntu.com/security/CVE-2026-84782) in
  [USN-8847-1](https://ubuntu.com/security/notices/USN-8847-1). The earlier two
  HIGH occurrences were one advisory across two packages. BoringSSL is not
  affected by that OpenSSL issue; it has a separate certificate-parsing DoS
  fix, [CVE-2026-35189](https://github.com/google/boringssl/blob/main/docs/advisories/2026-09-29.md).
- The actual candidate binary reports
  `50d48c6c6c964b06f1365cb54ed05a7e03ac631f/1.39.2/Clean/RELEASE/BoringSSL`.
  This differs from release-tag commit `018f6bf01f30dd46f4f1baffb40802598ed07b27`.
  The actual commit is its direct child; the
  [source comparison](https://github.com/envoyproxy/envoy/compare/018f6bf01f30dd46f4f1baffb40802598ed07b27...50d48c6c6c964b06f1365cb54ed05a7e03ac631f)
  changes three Bazel/toolchain files. Its
  [dependency declaration](https://github.com/envoyproxy/envoy/blob/50d48c6c6c964b06f1365cb54ed05a7e03ac631f/bazel/repository_locations.bzl)
  still pins fixed BoringSSL `0.20260929.0`, archive SHA-256
  `04da9ba0664e0a7f028e961c38d604f2cc6dac852a84ca0e51dc1fa051d4c8fe`.
  Source ancestry is evidence, not cryptographic image-to-source attestation.
- Upstream [container manifest publication succeeded](https://github.com/envoyproxy/envoy/actions/runs/37008109286/job/110849273143),
  but [GitHub release publication failed](https://github.com/envoyproxy/envoy/actions/runs/37008109286/job/110853144004)
  and [final verification was skipped](https://github.com/envoyproxy/envoy/actions/runs/37008109286/job/110854855576).
  Record this honestly; do not call upstream verification all-green or claim a
  tag-exact build. Digest-bound provenance remains unresolved.

The repeatable `npm run test:staging-envoy-candidate -- /path/to/verified/upstream`
probe runs the exact candidate with checksum-verified v0.8.0 gateway files and
synthetic Node backends, an internal-only Docker network, no published ports,
non-root users, read-only filesystems, dropped capabilities and resource limits.
It tests config compatibility, required/invalid API keys, admin/MCP denials,
legacy and modern API-key translation, preserved user JWT headers, websocket
route rewriting, untouched function payload/signature headers, encoded separator
rejection, path normalization and underscore-header rejection. It asserts the
actual binary/package identity and no IPv4/IPv6 default route. Only uniquely
named test resources are removed; existing services and volumes are preserved.
The Docker wrapper rejects endpoint environment overrides and remote contexts,
resolves an actual local Unix socket, and binds all operations (including the
probe client and cleanup) to that socket with a sanitized environment. Four
negative/regression test groups cover these controls, including a context change
after selection. This was added after a separate review identified the inherited
Docker-context risk; it does not imply other older probes have the same guard.

These backends deliberately echo synthetic traffic: they do **not** implement
Auth, RLS, Storage, Meta signature checking or the real Functions gateway. Thus
passing this probe does not prove real-service authorization, Cloudflare exact
path behavior, full-stack recovery, native VPS/load capacity or release readiness.
The upstream listener still allows broad CORS; staging-origin restriction is a
separate unresolved hardening item, not silently accepted by this test.

Raw candidate scan: `/private/tmp/barber-envoy-review.ONA1bC5Z/envoy-1.39.2.json`.
Report SHA-256: `13fbb4cab8f87b08d9d7b590ac65012ed28794bf23feae7ea07d406efe0612fe`.
The final local routing/isolation probe, targeted ESLint and full `npm run check`
passed. GitHub application CI now runs the opt-in candidate probe after fetching
the verified upstream configuration; this is not an automatic image upgrade.
The remaining seven component inventories and full-stack gates stay open.

## Staging-only CORS candidate — local preparation

All five checks passed for `ad2a304b553361b546efff8d56d83a6f6b199910` in
[CI run 37188608155](https://github.com/malabdullah/barberplusplus/actions/runs/37188608155).
This result covers the preceding Envoy candidate, not subsequent CORS changes.

The opt-in `--staging-cors` probe now prepares a restricted listener in a unique
temporary directory, without modifying upstream files, deployment pins or the
VPS overlay. `staging-envoy-cors.mjs` accepts only the exact reviewed upstream
listener SHA-256; modified, rendered and already-transformed inputs are refused.
The only allowed browser Origin is `https://staging-barber.malabdullah.cloud`.
Other Origins, including null, empty, duplicate, suffix-spoofed, insecure and
nonstandard-port values, receive 403 before upstream dispatch. Requests with no
Origin retain the ordinary API-key/JWT/signature gates; Origin is not proof of
identity and can be omitted by non-browser clients.

The native [Envoy CORS filter](https://www.envoyproxy.io/docs/envoy/latest/api-v3/extensions/filters/http/cors/v3/cors.proto)
keeps an explicit method/header/exposure allowlist, omits TRACE/CONNECT and
cookie-credential permission, and bounds preflight caching to 600 seconds.
Unsupported preflight methods/headers are not advertised as permitted; the
browser must enforce that list. A first-request/last-response
[Lua guard](https://www.envoyproxy.io/docs/envoy/latest/configuration/http/http_filters/lua_filter)
also strips backend `access-control-*` fields before emitting the restricted
policy. This prevents an Auth/Storage/Function backend wildcard or credential
header from silently broadening the gateway rule. Existing `Vary` fields are
retained with `Origin` added. API bearer tokens, not browser cookies, remain the
intended Supabase authentication mechanism.

The isolated Linux AMD64 probe passed against synthetic backends intentionally
returning permissive CORS headers: allowed preflight and responses, actual
duplicate-Origin rejection, unsupported method/header exclusion, wildcard and
credential stripping, preserved cache variation, non-browser requests, and
unchanged 401 authentication denial. All preceding gateway routing/signature
forwarding probes passed again. Six lightweight safety/negative tests and full
`npm run check` also passed. Review identified a temporary-file cleanup ordering
gap; cleanup now attempts all known container/network removals and always
attempts temporary-file removal, reporting failure rather than claiming cleanup.
The final CORS container rerun and all five Playwright journeys passed after
that cleanup fix. The browser journeys use the retained local synthetic database,
not the candidate gateway or VPS, and therefore do not certify CORS browser E2E.
All five required GitHub jobs then passed for CORS commit
`fe2fb0dc242ab458f25b207d66e51070ca130b94` in
[CI run 37189276664](https://github.com/malabdullah/barberplusplus/actions/runs/37189276664),
including both isolated Envoy variants and clean synthetic database replay.

This is candidate evidence, not browser/Cloudflare acceptance. Real websocket
handshakes, Storage uploads/resumable headers, Access cookie/preflight behavior,
actual Auth/Function responses and the live origin boundary still need end-to-end
verification before this transform can enter a deployment. No application,
database, public DNS, production resource or live credential was changed.

## Five further official candidates — scan-only evidence

The same verified Trivy 0.74.0 and vulnerability database scanned five more
explicit AMD64 manifests remotely. No candidate was executed or promoted, and
no finding was suppressed. Counts remain package/advisory occurrences, not
proven reachable vulnerabilities; applicability and source-provenance review
remain required. Merely choosing a newer version does not clear the gate.

| Candidate | HIGH | CRITICAL | Scanner coverage |
| --- | ---: | ---: | --- |
| Studio 2026.09.28-sha-5e59b60 | 303 | 16 | Debian 12.15: 171 packages; Node: 869 |
| Realtime 2.140.7 | 137 | 3 | Debian 13.6: 157 packages; no Erlang application coverage |
| Postgres-meta 0.99.0 | 93 | 6 | Debian 12.15: 91 packages; Node: 402 |
| Supavisor 2.9.13 | 418 | 21 | Debian 12.12: 263 packages; no Erlang application coverage |
| Imgproxy 4.0.17 | 0 | 0 | Ubuntu 24.04: 100 packages; Go binary: 193 packages |

Exact candidate references:

```text
supabase/studio@sha256:846f64ef85d0a97d3aad3b165d4ef3ffe7fdcc720ae12220af5b0f5f6edb7470
supabase/realtime@sha256:482868126f20243547d2d2cb03f78d78eeb318435c48198a1a43f8c491433864
supabase/postgres-meta@sha256:09b00cdd401f830cc8db5c7da14468e99d04a63900371b1ec06463674ac4877e
supabase/supavisor@sha256:c57b1222f3ca21a3180c202dea14806cc0be67cda633eb62bcc6481efc0e7a95
darthsim/imgproxy@sha256:be64f14896476c8613ebac98db241d152064256981f8149dd9e2f2f155e22dd1
```

Imgproxy's zero count is not full native-codec coverage or compatibility approval:
this is a major v3-to-v4 change, and its scan logs include third-party SBOM trust
warnings. Studio's dated official registry tag has a short source suffix that
could not be resolved through the official GitHub commit API; no source-revision
image label supplied the missing linkage. Do not call that provenance verified.
Supavisor moves off the previous Debian 11 base, but retains unresolved findings.
New Realtime migrations/tenant behavior and Meta's worker-based formatting need
disposable replay and compatibility tests, not a wholesale Compose update.

Primary version references:
[Realtime 2.140.7](https://github.com/supabase/realtime/releases/tag/v2.140.7),
[Meta 0.99.0](https://github.com/supabase/postgres-meta/releases/tag/v0.99.0),
[Supavisor 2.9.13](https://github.com/supabase/supavisor/releases/tag/v2.9.13),
[Imgproxy 4.0.17](https://github.com/imgproxy/imgproxy/releases/tag/v4.0.17),
[official Studio image tags](https://hub.docker.com/r/supabase/studio/tags).

Raw reports: `/private/tmp/barber-latest-component-scan.c2bR05/`.
Combined `summary.json` SHA-256:
`c6258c8bfd64aef15f56917c298294a92d21919909b0643227907218447ee322`.
Individual report SHA-256 values in component order above:

```text
4c44dc23c6830e56bb035b698bef4a102119a1f2341af5961907e00cc2d999f5
b35b50cd8db783d570c39ebbcde34284152982b4bf68a4a005420f91a0a42997
982e73900f01bf66dcc210081d53e70b339ddc4a75d12c8de370951fe49bf73c
990cfddde3565b0349ee052acfb14994f0c7fb632687651f8c228bfae28f3da6
bcf6c24e8f78da73568e178b15b8ac50cbe40912ba52803acb6a096212b65995
```

The owner subsequently approved omitting optional Studio/meta, Supavisor and
image transformation services from initial staging. The reduced configuration
is documented in `staging-vps-runtime.md`; no existing VPS service/data deletion
or deployment is authorized by that scope approval. This cannot clear the
remaining Auth, Storage, Realtime and full-stack readiness gates.

## Latest Auth and Storage follow-up

Two further official release candidates were scanned remotely with the same
methodology/database, without executing or promoting them:

| Candidate | HIGH | CRITICAL | Exact AMD64 digest |
| --- | ---: | ---: | --- |
| Auth 2.197.0 | 5 | 0 | `sha256:839f529492d116b4e8b7777c953a27c381d34c15a744b1bcefde5eefaa1f9f9f` |
| Storage 1.79.31 | 54 | 1 | `sha256:13cdccea43f23d848f050eba0d4f3ccdf02a7aca93d4f43268438de95549ef74` |

Repositories are `supabase/gotrue` and `supabase/storage-api`. Auth coverage was
17 Alpine packages and 156 Go packages; remaining matches concern OpenSSL,
pgproto3/v2 and gRPC. Storage coverage was 47 Alpine packages and 1,028 Node
packages, retaining a critical tar match. These are version matches, not a
claim of demonstrated application exploitability. Applicability/remediation
review is still needed. Auth's EOL-list warning does not establish Alpine's
support status.

The [Auth changes](https://github.com/supabase/auth/compare/v2.196.0...v2.197.0)
include five migrations and session/MFA/OTP behavior changes. The
[Storage changes](https://github.com/supabase/storage/compare/v1.74.0...v1.79.31)
include migration, listing, uniqueness-index and grants changes. Both need a
disposable compatibility/recovery rehearsal before replacing a pin.

Raw evidence: `/private/tmp/barber-auth-storage-scan.WKWMlO/`.
Combined summary SHA-256:
`cd6e61fe7a4504532919d2f6024dfba7cb70c52c8c105567a568864530c427ed`.
GoTrue scan report checksum (SHA-256):
`244b7e0f722fe81df718233072b99a01c700ff062fa59cbf43f7f5b7177f4d91`.
Storage report SHA-256:
`f738a937bcde56606c726495217193fbdfb071e880830e46d8ce3a798e3ce99c`.

### GoTrue candidate applicability review — preliminary, no exception

The official v2.197.0 source resolves to
`4eee58f296d9698a1c2c0ae14d7a0b379c7622d3`. Its Dockerfile uses `CGO_ENABLED=0`.
Inspection of the exact scanned AMD64 binary, without running that binary,
confirmed Go 1.27.0, CGO disabled, pgproto3/v2 2.3.3 and gRPC 1.82.1. The image
has no source-revision label and the binary exposes no VCS revision; this does
not establish signed source-to-image provenance.

- The two OpenSSL package matches concern a QUIC server. The binary metadata
  and loader inspection are consistent with a static Go executable, not a
  dynamically linked OpenSSL server. This narrows applicability; it is not a
  blanket package exception or proof about every executable in the image.
- The [pgproto3 advisory](https://pkg.go.dev/vuln/GO-2026-4518) requires malicious
  PostgreSQL responses and has no listed fixed v2 version. Connecting only to
  the dedicated staging database reduces exposure but does not patch the
  dependency or protect against a compromised peer.
- The [gRPC memory fix](https://github.com/grpc/grpc-go/pull/9331) and
  [missing-authority fix](https://github.com/grpc/grpc-go/pull/9365) need separate
  reachability review. Tagged Auth source uses gRPC for optional outbound OTLP
  exporters. No direct gRPC/xDS server constructor was found in its application
  source, but that search is not a complete transitive call-graph analysis.

Initial staging now explicitly disables `GOTRUE_TRACING_ENABLED` and
`GOTRUE_METRICS_ENABLED`, with validator rejection of enabled/missing gates or
nonempty `OTEL_*` settings. The tagged source gates exporter initialization on
these booleans. This is an outbound/quarantine control, not a vulnerability
suppression. Scanner findings remain recorded and deployment pins unchanged.

Source references: [Dockerfile](https://github.com/supabase/auth/blob/4eee58f296d9698a1c2c0ae14d7a0b379c7622d3/Dockerfile),
[tracing](https://github.com/supabase/auth/blob/4eee58f296d9698a1c2c0ae14d7a0b379c7622d3/internal/observability/tracing.go),
[metrics](https://github.com/supabase/auth/blob/4eee58f296d9698a1c2c0ae14d7a0b379c7622d3/internal/observability/metrics.go).
