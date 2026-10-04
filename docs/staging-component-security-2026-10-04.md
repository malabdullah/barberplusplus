# Staging component security inventory — 2026-10-04

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
Auth report SHA-256:
`244b7e0f722fe81df718233072b99a01c700ff062fa59cbf43f7f5b7177f4d91`.
Storage report SHA-256:
`f738a937bcde56606c726495217193fbdfb071e880830e46d8ce3a798e3ce99c`.
