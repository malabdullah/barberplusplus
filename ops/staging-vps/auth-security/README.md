# Auth security candidate — local only

No deployment, publication, production change, scanner exception or release
acceptance is authorized by these assets. This is a downstream source build,
not an official Supabase image. The archived pgproto dependency creates an
explicit maintenance and review obligation before adoption.

## Locked inputs and changes

- Auth source: [`4eee58f296d9698a1c2c0ae14d7a0b379c7622d3`](https://github.com/supabase/auth/tree/4eee58f296d9698a1c2c0ae14d7a0b379c7622d3)
  (`v2.197.0`); source archive SHA-256
  `dd5168b9f0bb294fa1e1d343c23b6bb5f68376f271d97dea897339b28fbd4b8d`.
- Exact builder: Go `1.27.1-alpine3.24` AMD64 manifest
  `sha256:cd9a32216aee5667f957a62d13a10032a63fd58e14b3f3d9cc8c2122f501e95e`.
- Runtime: official Auth `v2.197.0` AMD64 manifest
  `sha256:839f529492d116b4e8b7777c953a27c381d34c15a744b1bcefde5eefaa1f9f9f`.
- [`grpc-go 1.83.2`](https://github.com/grpc/grpc-go/releases/tag/v1.83.2)
  replaces `1.82.1`, requiring `x/net 0.58.0` instead of `0.57.0`.
  `go-dependencies.patch` locks the module/checksum changes; the helper asserts
  their resulting hashes before and after vendoring.
- `pgproto3/v2` honestly retains version `2.3.3`. The one-condition downstream
  guard rejects negative field lengths after handling the valid `-1` NULL
  sentinel. It follows the fix described in [upstream issue 2507](https://github.com/jackc/pgx/issues/2507).
  [The Go advisory](https://pkg.go.dev/vuln/GO-2026-4518) lists no fixed v2 release.
- Runtime `libcrypto3` and `libssl3` are upgraded from `3.5.7-r0` to exact
  `3.5.9-r0`. The earlier attempt to install `3.5.8-r0` failed because that
  version had left the repository; its failure log is retained.

`prepare.mjs` verifies the archive and every patch/test/build asset, extracts
only into a new private temporary directory, binds Docker to a verified local
Unix socket, vendors dependencies and verifies module checksums. It requires
the original negative-length regression to fail, then applies the guard and
verifies the exact patched decoder checksum. No vendor tree belongs in Git.

## Reproduce

Download the [exact source archive](https://codeload.github.com/supabase/auth/tar.gz/4eee58f296d9698a1c2c0ae14d7a0b379c7622d3)
to a private local file. From the repository root:

```sh
node --test ops/staging-vps/auth-security/prepare.node-test.mjs
node ops/staging-vps/auth-security/prepare.mjs /absolute/path/to/auth-source.tar.gz
```

The helper prints a fresh source directory but does not build or publish an
image. Build that directory through `localDockerProbe()` using
`docker(['build', '--platform', 'linux/amd64', '--file',
source + '/AuthCandidate.Dockerfile', '--tag', uniqueLocalTag, source])`.
The Dockerfile runs network-disabled vendored Go unit tests, a 20-second fuzz
test and compilation before copying the binary and matching migrations.
Export the exact resulting local image ID through the same wrapper and scan
its archive with Trivy `image --input`, without suppression or ignore-unfixed.
Do not reuse a mutable local tag as acceptance evidence.

These are pinned, reproducible build inputs and a retained recipe, not a claim
of bit-identical rebuilds, signed provenance or permanent availability of APKs.
Any changed input/checksum requires explicit review; never refresh locks merely
to make the helper pass.

## Observed evidence — 2026-10-04

Scratch artifacts: `/private/tmp/barber-auth-remediation.vlyZ06/`.

- Original decoder: expected regression failure and panics for `-2`,
  `INT32_MIN` and `-16` lengths.
- Patched negative/truncated/valid/NULL-row regressions: passed.
- Auth observability, configuration and crypto unit tests: passed.
- Decoder fuzzing: **668,391 executions in 20 seconds**, no panic.
- AMD64 compilation: passed; binary metadata reports Go1.27.1, CGO disabled,
  gRPC1.83.2 and the original pgproto3/v2.3.3 dependency identity.
- Fresh Trivy0.74.0 scan: **1 HIGH / 0 CRITICAL**, with the October 4 database.
  Coverage: 17 Alpine packages (zero findings) and 156 Go packages (one).
  The remaining unsuppressed finding is `CVE-2026-32286`, matching unchanged
  pgproto3 version metadata. The explicit patch/regression/fuzz evidence
  addresses its reported negative-length crash path; this is not a blanket
  audit or a zero-finding scan. Four gRPC/OpenSSL occurrences were removed.
- The repository preparation helper replayed successfully from the checksummed
  source archive into a second fresh directory, including locked dependencies,
  expected vulnerable-baseline failure and exact patched decoder bytes.
  Three helper safety tests, targeted ESLint and syntax checks passed.

The source unit/fuzz tests do not prove database migration compatibility,
login/refresh/recovery, SMTP isolation, JWT behavior or integration acceptance.
The parent task owns a separate opt-in exact-image core/recovery rehearsal.
No application/frontend change or full browser suite is claimed here.

### Exact local identities

Docker Desktop's containerd store distinguishes the daemon-addressable OCI
index from the platform-specific manifest returned by `inspect --platform`:

```text
local tag: barber-auth-remediation:vlyz06
OCI index: sha256:add5d67a982f17b36538b37ac316095bc5b6ddb9549207ca4e764aadb8307755
AMD64 child: sha256:aa5adadc5b0e338b64d2d4565c6f7820989f778cb9e89895b1c4a07ed079302d
```

Observed non-secret labels:

```text
org.opencontainers.image.source=https://github.com/supabase/auth
org.opencontainers.image.revision=4eee58f296d9698a1c2c0ae14d7a0b379c7622d3
org.opencontainers.image.version=v2.197.0-barber-security-local1
cloud.malabdullah.barber.candidate=LOCAL-ONLY: downstream vendored pgproto3 patch; grpc1.83.2; not upstream official release
```

The revision label names the upstream base; the explicit downstream label and
external patch hashes identify modifications. Labels alone are not attestation.
Bind local tests to both the index and AMD64 descriptor, not a presumed registry
digest or nonexistent source-revision guarantee from the original image.

### Evidence hashes (SHA-256)

```text
candidate.tar: 9a6f3689c7e08e1a81a7dbc73ebe00e37fbab4e567fbd8020a01d6a9db63f4d0
candidate-scan.json: e744f6642bb6ed73d0721ead8977dadceeaa030fae3eb5992bdc0ab5b8b9bc0b
build.log: 3b9b9c78176c0fb28409c4d49c70165c00015adfd5e1ea58dd3e2c2063ba5db0
baseline-test.log: c4bc5adf6d0af6b325829cff9e4b1c37e6235f1f621cf44417e550df92091380
go-dependencies.patch: 4066407b7d035eb17d346055ab74836f8cefd9b75e53ae5d6462cd62ec87dbb2
pgproto3-negative-length.patch: 9962dd283f834dd0237a6cf51bed4eb18b6d22e8422c6218aa4403c398daa3c2
original decoder: 6cf3e036a8ac399d981060253720d5fbb0cd026d1fb1808540cd6dfc9771aa4c
patched decoder: c9deb828e74f5bc7396df0861ee493026aa994dbc58796fd927342ffa6b4a853
```

The repository decoder patch uses a shorter context hunk than the scratch
patch (scratch SHA `28b0024c5d9d200cebe653a6b03afb5215683ae0c94b4993bf96bfaeca65e735`);
both produce the same checked decoder bytes. The source build/test evidence
therefore remains tied to exactly the same code change, not a different fix.

Before adoption: independently review the patch and source locks, complete
the exact-image core/recovery checks, explicitly approve maintaining this
downstream component, and resolve the release-specific unsuppressed advisory
disposition. Alternatively pursue an upstream-supported pgx/pop migration or
future Auth release. Neither route is silently selected by these assets.
