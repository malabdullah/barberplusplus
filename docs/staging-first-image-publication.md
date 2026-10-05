# First staging image publication — October 5, 2026

Status: **images and signed evidence published; no deployment authorized or performed**.

The owner explicitly approved merging PR #3 at
`ca49c87a1a05b7ac28d26b7b5ddf4cfc06a62798` after all five CI checks passed,
and building/publishing images only. This approval excludes the protected
staging evidence job, server deployment, automation activation, public routing,
DNS changes, and production.

## Verified results

- PR #3: <https://github.com/malabdullah/barberplusplus/pull/3>.
- All five PR checks passed in run `37273811572` at the approved head.
- Normal protected merge completed at `2026-10-05T06:49:15Z`; no admin bypass.
- Main merge commit: `bbfed73c61bfb46cd93f3c4c57f5b184c8825fae`.
- Merged tree equals the approved head tree:
  `66dbea9f1b181be5c3bc2e6ec078c7772ac3c74d`.
- Main CI run `37274366418` succeeded. Application, browser, database and
  secret-scan passed; the PR-only dependency-review job was skipped on push
  (it passed on the approved PR).
- Workflow run `37274747469`, attempt 1, build job `111649210919` succeeded.
- Frontend: `ghcr.io/malabdullah/barberplusplus@sha256:0ab7b92c50b588e0b2bdff9e54db1746e5826897cba27ca56c25b7778cf72bae`.
- Functions: `ghcr.io/malabdullah/barberplusplus-functions@sha256:e766c8c7ba3f4beef5c4afd592245b24dfe893ad12454200971608073d0cc3c8`.
- Both tags use the full main merge commit above. Digests are from successful
  build/push metadata, not yet independently authenticated registry reads.
- Workflow Git blob: `feaa336ac610ba3e33b5b2a686325f000395b4aa`.
- Workflow SHA-256: `d2f54b4eebecaa2d3ee5fc9ed73c197f7df4fdd760a3066a9708f438133b7ac2`.

## Gates remain closed

The owner subsequently explicitly approved the `release-request` job only for
run `37274747469`, attempt 1. That approval was applied to protected environment
`staging` (ID `21158713380`), with an explicit evidence-only/no-deployment comment.
Both jobs and the full workflow completed successfully. The job created the
short-lived release envelope and attestations for it and both image subjects;
it did not deploy or change the VPS.

### Read-only verification after evidence approval

- Release artifact ID: `11330456005` (811-byte ZIP).
- Archive SHA-256: `548056a708e84dee79608829a5dc933604faaf4fa6c702ef6459760b2c52e382`.
- Envelope SHA-256: `58ed9e6f06ac70116fe6d8313ddebee88d3c82b3d88bfb999aa443c9e8b50e64`.
- Issued `2026-10-05T07:04:55.975Z`; expires `2026-10-05T07:19:55.975Z`.
- Official GitHub CLI cryptographic verification and the repository's exact
  certificate-policy parser passed for the envelope, binding repository/owner,
  GitHub-hosted workflow identity, main commit, run and attempt.
- Live API transport, canonical envelope syntax, first-attempt owner approval,
  protected environment policy, reviewed workflow fingerprints and successful
  main CI binding passed the existing read-only verifier modules.
- All four committed migrations match the envelope tree:
  `sha256:d63950bea2e0a22484d1fb91a309ba90716f81c971cd193203146fbba3bad9d0`.
- GitHub returns one attestation for each image digest. Subsequent read-only
  registry and signature verification passed for both, as recorded below.

All verification results are non-authorizing. The envelope expires after 15
minutes and must not later be treated as fresh deployment authority. No replay
ledger was consumed and no root policy was changed. Retain this run as evidence
of the signed-evidence path, not as an accepted staging release.

The Mac's interactive GitHub CLI credential cannot read package metadata
(HTTP 403, missing `read:packages`). Its scope was not expanded. The existing
dedicated encrypted VPS package-reader credential subsequently verified both
packages' metadata, repository ID and immutable manifest bytes. It stayed in
VPS memory and retained exactly `read:packages`; no credential was copied to the
Mac. Both packages were **public**, not the expected private default. The owner
explicitly approved keeping the code packages public while keeping staging
website/database access private. No package visibility was changed. The reason
for the observed existing visibility has not been established.

### Image verification and release repair

The published digests are OCI indexes, each containing one linux/amd64 runtime
and one BuildKit attestation descriptor. The original reader requested only
single-image manifest formats and the real registry read failed with HTTP 404.
The feature-branch fix accepts the reviewed index profile and preserves its
signed top-level digest; it rejects ambiguous runtimes, nested indexes, external
descriptor URLs, unsupported platforms and unbound auxiliary descriptors.
It does not claim to verify child layers merely by reading the index.

Both downloaded index byte hashes matched GHCR's digest headers and the release
envelope. Official CLI cryptographic verification plus the exact certificate
policy passed for both image subjects against commit/run/attempt above.
The patched reader and `verifyStagingImageAttestationOnline` then both passed
against the live registry anonymously. Evidence is local under
`/private/tmp/barber-image-evidence.RTpGMB/`; secrets are not included.

The published Functions image used the older v1.74.0 recipe, not the hardened
v1.77.4/distroless runtime used in the private bootstrap. It is **not accepted
for deployment**. The reviewed upstream/distroless pins and preserved binary
are now reproduced in `ops/staging-vps/Dockerfile.functions-release`, without
local candidate tags. CI and the publication workflow use that same new recipe.
This is a proposed workflow change, not an authorized replacement publication.

Local release-recipe test: AMD64 platform image
`sha256:00796bc483d9226216b2934c098123f37950b5af0cec102728195c6d68533ca1`,
local index `sha256:831640122f2b596e63f6e740cf74c8321a45f05b38ba2a5ea23baa0f3a0c2ff2`.
All eight workers, JWT/cron/Meta denials, exact paths, CORS, encrypted Flow
round-trip and tamper rejection passed offline with synthetic inputs. Disposable
test containers/networks were removed; image caches remain. The function source
was main `bbfed73`; the Dockerfile/test changes were the uncommitted feature
branch snapshot, not an already-published release.

Trivy 0.74.0 official macOS ARM64 archive SHA-256:
`1caada5e0e2091909357c7525d3aa76f4b660b13821bc143b190c7483e31cc11`.
Fresh DB updated `2026-10-05T01:10:31.191619217Z`, downloaded
`2026-10-05T07:29:06.602791Z`; explicit empty config/ignore files, sanitized
environment, no ignore-unfixed, no severity override or telemetry.

| Scanned artifact | OS coverage | High / Critical | Detected secrets | Raw report SHA-256 |
| --- | --- | --- | --- | --- |
| Local hardened Functions release candidate | 14 Debian packages | 0 / 0 | 0 | `7a6ab21bc56414f816a3a094ea3eff561b37565063689f45edcf52f303beb042` |
| Exact published frontend above | 70 Alpine packages | 0 / 0 | 0 | `43ede690606e88b286a5a39d1aa7e081912ff7bd321eacb9061e0b1016b53e1c` |

These scans do not establish complete Rust/Deno/V8/ONNX dependency coverage,
absence of all secrets, or live staging acceptance. The replacement published
Functions artifact must be checked after a separately approved merge/build.

The exact published frontend also passed a local disposable runtime probe:
health, expected main release, staging configuration, CSP, no-store, noindex,
nosniff and UID 101. Its container had network `none`, no published ports and no
mounts, and was removed afterward. This does not prove VPS routing or live TLS.

Separate AI code review (not independent human review) checked index digest
preservation, strict AMD64 selection, attestation linkage, credential destination
allowlisting, release/CI recipe parity, exact upstream binary/ONNX preservation,
unprivileged runtime and unchanged closed deployment gates. Local full
`npm run check`, 68 verifier tests, five package tests and all five browser
journeys passed without database reset. No application/schema change occurred.

Format references: [OCI image index](https://github.com/opencontainers/image-spec/blob/main/image-index.md)
and [BuildKit attestations](https://docs.docker.com/build/metadata/attestations/).

Replacement-image publication/verification, VPS observer/broker implementation,
release-specific server authorization, public ingress and full staging acceptance
remain outstanding. In particular, publishing the Functions image does not prove
equivalence to the previously tested private-bootstrap downstream runtime.

No VPS service, credential, firewall, DNS, production resource, automation policy,
or earlier PR was changed by this merge/publication step. Env3 is not yet complete.
