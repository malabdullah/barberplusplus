# Hardened replacement image publication — October 5, 2026

Status: **published, scanned and signed evidence verified on Mac and staging
VPS; not deployed, not accepted as a staging release**.

The owner explicitly approved merging PR #4 at
`e303703f1ddc2921579807fa0b4d73b916249758` and building replacement images only.
No evidence-job approval, server deployment, automation activation, public
routing, DNS change or production access was included.

## Merge and build evidence

- PR: <https://github.com/malabdullah/barberplusplus/pull/4>.
- All five required PR checks passed in CI `37278335750` at the approved head.
- Branch and staging-environment protections were rechecked unchanged.
- Normal protected merge, no admin bypass, at `2026-10-05T07:53:31Z`.
- Main commit: `ed9c656eb8f8509087bbc832b7a6f7a561d76a9e`.
- Main tree matches the approved head tree:
  `c1dbfae9321c31f6a41b2929a8ed9bb6292b321c`.
- Main CI `37280292927` passed; dependency-review was PR-only and skipped on
  push, having passed on the approved PR.
- Publication run `37280715144`, attempt 1, build job `111667902184` succeeded.
- Workflow Git blob `d9becad4f047d05e97d9d169e32ed14079e56931`, SHA-256
  `2012cc673882f0704e64c003d88af3b9a8071fa02b57ffe946400cd023381eea`.

## Exact registry artifacts

Both image tags use the full main commit above. The reader independently
verified top-level bytes against the expected SHA-256 and registry header;
each index contains one AMD64 runtime and a bound BuildKit attestation descriptor.
Public anonymous reads passed, consistent with the owner's previously approved
public-code-package/private-staging-access policy. No visibility was changed.

| Role | Signed-subject candidate / top-level index digest | AMD64 runtime descriptor |
| --- | --- | --- |
| `ghcr.io/malabdullah/barberplusplus` | `sha256:aa00099342562a387f3117e9330aadfbfea334bbbb6c8b9a147db261555cab73` | `sha256:757202259ec05c76a659d7f12dbcaa3bae398191c43e67a6c285504a6b495c29` |
| `ghcr.io/malabdullah/barberplusplus-functions` | `sha256:f6a0800e90f3687741c4caaa5b2ae9930b6e41c933817ac8ba39922ba4321417` | `sha256:2c83ff75d99f05a12afead2ff2d739888862991bda1614a1b09687238f04c87d` |

Do not replace the top-level release identity with a child descriptor digest.
The Functions image uses `Dockerfile.functions-release`, tested by the successful
CI, instead of the old v1.74.0 recipe. The earlier published Functions image is
not a deployment fallback or accepted release.

## Scans of these exact published artifacts

Verified official Trivy 0.74.0; empty config/ignore files and sanitized scanner
environment, no ignore-unfixed or severity overrides, telemetry disabled.
The vulnerability DB is updated `2026-10-05T01:10:31.191619217Z`; the scanner
checked for updates before scanning the explicit linux/amd64 artifacts.

| Artifact | OS inventory | High / Critical | Detected secrets | Raw report SHA-256 |
| --- | --- | --- | --- | --- |
| Frontend | 70 Alpine packages | 0 / 0 | 0 | `277b007e62342501ed5c037c655802c0e15f666ca728cce37d7d36749b7bb070` |
| Hardened Functions | 14 Debian packages | 0 / 0 | 0 | `3770e5828cd3cc78a31e30a31bfaa58d60b03479a59a3f64f2e1ea2ab0c0cd33` |

OS scanning does not establish full compiled Rust/Deno/V8/ONNX coverage or prove
the absence of all secrets. Local evidence is retained under
`/private/tmp/barber-replacement-evidence.jGBRXn/`, subject to temporary-file
cleanup by the OS. These results do not establish live VPS acceptance.

## Separately approved signed evidence

The owner explicitly approved signed evidence only for run `37280715144`,
attempt 1. Before applying that approval, the exact commit/run/attempt and
staging environment controls were rechecked. The recorded approval comment
explicitly excludes deployment, automation activation, DNS and production.
The evidence job and overall workflow subsequently succeeded.

- Artifact ID `11332542049`, 812-byte ZIP.
- Archive SHA-256 `683dae2df4d4d8890e5864ab4a722babfbca0b077eb3f7ffc6ea6143bcfe385e`.
- Envelope SHA-256 `844d9c0641a2d711653b70ba111d4073fa25e41316dc53b080235678ffb6350e`.
- Envelope issued `2026-10-05T08:04:36.689Z`, expires `2026-10-05T08:19:36.689Z`.
- Mac verification completed at `2026-10-05T08:06:43.152Z`.
- Official GitHub CLI verified the envelope and both image attestations;
  certificate-policy checks bound each to the exact repository, owner, source
  commit, protected-main workflow, GitHub-hosted runner, run and attempt.
- The existing read-only modules verified approval/environment policy, exact
  successful main CI, workflow fingerprints, artifact ZIP hash/size/identity,
  canonical envelope, both GHCR index digests and all four migrations.
- Migration tree remains
  `sha256:d63950bea2e0a22484d1fb91a309ba90716f81c971cd193203146fbba3bad9d0`.

### One-shot verification on staging VPS

A one-time administrator-run observation on `srv1207055` repeated the real
evidence checks using the installed official CLI and existing restricted
GitHub App credential. It did not install a service or grant a new identity
credential access. The App key was decrypted into process memory only, with
core dumps disabled; a temporary installation token was restricted to repository
ID `1123713308` and exactly Actions/Attestations/Contents/Metadata read permissions.
Installation identity and the single-repository scope were checked. The token
was explicitly revoked afterward. No credential value was printed or written
to a plaintext file.

All three signatures, approval, CI, registry digests and migration checks passed.
Chrony verification at `2026-10-05T08:10:59.237Z` gave error bound
`0.0015532525` seconds (about 1.6 ms). The envelope was still fresh at that time.
Temporary non-secret artifact/cache files were confined to a new private scratch
directory and cleaned up afterward. Existing services and credentials remained
unchanged. The sanitized receipt is `vps-observation.json` in the local evidence
directory above; probe source SHA-256:
`f4713545549b8be7b5d8c7623eec1a9956bb739ef58a7cd49985b6b0c6ad6f0a`.

The shipped verification modules matched reviewed commit `e303703` byte-for-byte.
This was an administrator one-shot probe, **not** proof of an installed
least-privileged observation service, persistent replay ledger or authorization
to consume a release. No fake empty ledger was substituted, no root allowlist
was changed, and no deployment acceptance was declared. After expiry, retain
this as historical evidence; do not use it as fresh deployment authority.

## Next gate

Prepare and test the reusable observation-only service, its restricted credential
wiring and durable audit/replay handling. Its installation requires a separate
approval because it gives the dedicated service access to the existing read-only
App credential. Keep scheduled polling and all deployment permissions disabled.

The observation service, replay ledger, constrained mutation workers, actual
deployment, public ingress and full staging acceptance remain incomplete.
No VPS service, credential, firewall, DNS or production resource changed in
this merge/build/scan step. Env3 remains incomplete.
