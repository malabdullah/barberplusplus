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
