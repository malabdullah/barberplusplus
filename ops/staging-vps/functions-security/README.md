# Minimal Functions runtime candidate

Local staging candidate only. No deployment pin, application source, production
resource or upstream binary is changed by these assets. The main integration
must compile and test every Barber worker/Flow on this runtime before acceptance.

## Exact provenance

Official [Edge Runtime v1.77.4](https://github.com/supabase/edge-runtime/releases/tag/v1.77.4),
source commit `d4a4f606a90e8c66864219c9b1d31ef0e3e3f626`, AMD64 manifest
`sha256:fded42ff725708990b1a0803633c2659453259d075c4bec6b4d01dfb82dc055e`.
Runtime base: official [distroless cc-debian13](https://github.com/GoogleContainerTools/distroless/blob/main/cc/README.md)
nonroot AMD64 manifest
`sha256:20afe6a70f2565277b704cc17289cb557f353a3619f6350f52a2317106598df4`.
Both are pinned by platform digest; no floating image is used during the build.

The Dockerfile copies the exact official executable and all three ONNX library
filenames, without recompiling, stripping, patching or changing their bytes.
Independent extraction from the final local image verified:

| Artifact | SHA-256 |
| --- | --- |
| `/usr/local/bin/edge-runtime` | `7883510fe308b4b5c49ec0a8e2020ec81c5fa41133239f3969a372b1cbf107ba` |
| `/usr/lib/libonnxruntime.so` | `a5faaf78a37590d3fe640f887620e74f6022d34550172b91ad2131bf0ad77d64` |
| `/usr/lib/libonnxruntime.so.1` | `a5faaf78a37590d3fe640f887620e74f6022d34550172b91ad2131bf0ad77d64` |
| `/usr/lib/libonnxruntime.so.1.20.1` | `a5faaf78a37590d3fe640f887620e74f6022d34550172b91ad2131bf0ad77d64` |

Upstream linkage/hashes are also retained inside the image under
`/usr/local/share/barber-edge-evidence/`. The official binary itself reports
`edge-runtime 0.1.0` / `deno 2.1.4`; the release identity comes from its pinned
upstream manifest/source, not that generic CLI version string.

## Native compatibility and integration

The dynamic loader resolves the executable's libc/libm/libgcc dependencies and
ONNX's additional libdl/librt/libpthread/libstdc++ dependencies from the supported
distroless base. It reports no missing library. The source uses ONNX dynamic
loading, so all original ONNX files are retained with `ORT_DYLIB_PATH` explicitly
set to `/usr/lib/libonnxruntime.so`. The source also uses OpenBLAS at build time;
the preserved release executable has no dynamic BLAS/LAPACK dependency in its
loader list. No shared system library is copied out of the older Debian12 image.
No claim is made that arbitrary native npm packages, CUDA or local AI inference
models have been exercised; they are not part of the eight Barber worker check.

This is a maintained minimal runtime, not a stripped full Debian root filesystem:
distroless's complete OS package metadata, CA roots and timezone data remain.
It has no shell/package manager. A distinct official shell-containing builder
must run the bundle compilation loop. Then copy only the verified bundles and
manifest into this runtime; do not use this image for shell-based build steps.
Diagnostics requiring `docker exec ... cat` must use safe `docker cp` or other
outside-container inspection instead of adding a shell to the runtime.

Runtime defaults: UID/GID `10001:10001`, working directory `/home/deno`,
`HOME=/tmp`, `DENO_DIR=/tmp/deno`, `XDG_CACHE_HOME=/tmp/cache`, entrypoint
`edge-runtime`. A compiled application should set `CMD` to
`start --main-service /home/deno/bundles/main.eszip`. Use read-only rootfs,
capabilities dropped, no-new-privileges, bounded writable `/tmp`, an internal
network, no host mounts/socket and no published worker port. Supply staging-only
secrets at runtime, never in the image or build context.

## Local validation

```sh
node ops/staging-vps/functions-security/build-local.mjs
node ops/staging-vps/functions-security/probe-local.mjs sha256:EXACT_LOCAL_ID
node ops/staging-vps/functions-security/scan-local.mjs sha256:EXACT_LOCAL_ID /absolute/path/to/verified/trivy
```

Every Docker operation uses the verified local Unix socket. Probes use named,
labelled disposable containers with cleanup, no network or ports, read-only root,
no capabilities, no-new-privileges, CPU/memory/PID limits and private `/tmp`.
Version/help, loader resolution and all four independently copied hashes passed.
The probe does not claim worker, HTTP, TLS, Flow, database or AI-model coverage.

Local base index:
`sha256:b00379f2cd56e0da0e721968a0593ff8b15b0cfb758223e5316aac8d30600431`.
Selected AMD64 manifest:
`sha256:edfc3b271d665ed9df4e01cc1e6c0144fed184246cc30785974aa1c701c52156`.
Final native probe: `/private/tmp/barber-edge-probe.T9KqB3/evidence.json`.

Fresh scan with isolated configuration and DB updated
`2026-10-04T08:52:32.606987838Z`: **0 High / 0 Critical**, 14 OS packages on
Debian13.7. Raw scan `/private/tmp/barber-edge-scan.8Wzv2J/raw.json`, SHA-256
`5d59f8781d0ed4259d851ba8f798ca13304a1f658b82b62407e34c8749f61c5c`.
The original compiled v1.74.0 image had 66 High / 6 Critical; official v1.77.4
alone had 56 High / 4 Critical using the same database revision. No ignore file
or severity suppression is applied. Scan the final bundled application image
separately: these numbers describe the runtime base only.

OS scanning does **not** establish security of statically compiled Rust/Deno/V8
or ONNX dependencies; those need upstream/source advisory coverage. Zero reported
OS High/Critical is not full security acceptance. Local temp evidence is not a
durable release attestation. No image was published or deployed by this work.
