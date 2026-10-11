# Observer release image publication — October 8, 2026

Status: **images published and scanned; approved evidence job and live manual
observer passed; not deployed or accepted as a staging release**.

The owner approved merging PR #5 at `47e771ca2aa1a002c204e9226d23c31f27d69089`
only after its five required CI checks passed, and building images. This did not
approve the protected evidence job, deployment, DNS, automation or production.

## Merge and CI

- PR: <https://github.com/malabdullah/barberplusplus/pull/5>.
- PR CI `37747161237`: all five required checks passed at the exact approved head.
- Main protection reverified: PR required, zero second-person reviews under the
  approved solo-owner policy, five checks bound to GitHub Actions app 15368,
  strict updates, admin enforcement, resolved conversations, no force/deletion.
- Staging environment `21158713380` remains protected-main only and requires
  owner `malabdullah` / `19295903`, with self-review permitted.
- Normal protected merge, without admin bypass: `2026-10-08T08:06:56Z`.
- Main commit: `6217cb33bd9aaf32aa0fa924278f314988449f12`.
- Merge and approved-head trees match:
  `0bef401d7fd5ee3a50e06b5dfb7da4792b7fce68`.
- Main CI `37747708348` passed; dependency-review is PR-only and skipped on push.
- Publication run `37748167638`, attempt 1, build job `113214567997`: succeeded.
- The workflow is unchanged: Git blob `d9becad4f047d05e97d9d169e32ed14079e56931`,
  SHA-256 `2012cc673882f0704e64c003d88af3b9a8071fa02b57ffe946400cd023381eea`.

## Published image identities

Anonymous GHCR reads verified each top-level manifest body and registry digest.
Each OCI index has one AMD64 runtime and a bound BuildKit attestation descriptor.
Package visibility was not changed; the owner's public-code/private-staging
decision remains in force. Do not substitute runtime child digests for the
top-level identity to be signed by the protected evidence job.

| Image | Top-level index digest | AMD64 runtime descriptor |
| --- | --- | --- |
| `ghcr.io/malabdullah/barberplusplus` | `sha256:4d656e8cf03535b14c7a1cd5d55c604e0bb172147777102d854ae6f329659aab` | `sha256:7be1255b878788fe19f9c4f448ded439b324f21a7a39d8cd1aeccf26ffead86d` |
| `ghcr.io/malabdullah/barberplusplus-functions` | `sha256:b748a2d51c78df994ff93e0e26066d8193d61032ee2c21cad75264c1f2bb4c35` | `sha256:8922d718e9a17d45beca5342ceb25c0ee9dfbb9e6686a6fe3876a6f50ca50ae6` |

Both tags equal the full main commit above. No image was installed on the VPS.

## Point-in-time scans

Official Trivy 0.74.0 archive hash reverified against the previously reviewed
release, and the scanner binary matched the archived binary exactly. Scanner
SHA-256: `0ed07c205ca9ecc1065dc57b9f9f77adc79393bb469d9d1de9ec90c8c94ffc2f`.
An isolated empty cache downloaded the database at `2026-10-08T08:14:07.979561Z`.
Its reported update time is `2026-10-07T07:38:55.515026687Z` and next-update time
`2026-10-08T07:38:55.515026457Z` (already past when downloaded). Record this
upstream freshness limitation; do not describe the DB as newer than it is.

Empty config/ignore files, no suppression or ignore-unfixed, telemetry disabled,
sanitized scanner environment; exact image digest and `linux/amd64` platform.

| Artifact | OS packages | High / Critical | Detected secrets | Raw report SHA-256 |
| --- | --- | --- | --- | --- |
| Frontend | 70 Alpine | 0 / 0 | 0 | `313f3efacdd9a48ffc3c777ba0de388f84596b7417d567b58b4b05d6e25475f1` |
| Functions | 14 Debian | 0 / 0 | 0 | `a57bf562b4f42b02875f739cb0d367fc159cfe04633f71de90f434819bd9c44f` |

OS inventory scanning does not fully cover compiled Rust/Deno/V8/ONNX or prove
absence of all secrets. Raw reports and registry evidence are owner-only under
`/private/tmp/barber-observer-release.mJsEnV/`, subject to temporary-file cleanup.
These scans do not certify live deployment or full runtime security.

## Approved evidence and live observer receipt

The owner subsequently explicitly approved only this run's evidence job and
manual read-only VPS verification. Protected job `release-request`
(`113215225512`) succeeded on attempt 1. GitHub deployment record `6930533114`
describes that evidence job, not an actual application deployment.

- Artifact ID: `11537368251`.
- Artifact name:
  `staging-release-request-6217cb33bd9aaf32aa0fa924278f314988449f12-37748167638-1`.
- ZIP: 814 bytes, SHA-256
  `8fdc2cc020db3d14f58df0704f8981cf3133548d5d86c15463609b1cc79e1033`.
- Signed envelope SHA-256:
  `ce942f48994d26a6b813d1d8a943466796c771a7a228978d696aeef012dbbdda`.
- Root-owned selection SHA-256:
  `bc87afc3e51a2a4128742ce441392e6877bd6b5f9416442e9245e054ac99547b`.
- Selection before/after copies: `/root/barber-observer-selection.73HOU2/`.
- Manual service started `2026-10-08T08:36:00.733Z` and completed
  `2026-10-08T08:36:23.153Z` with `individual-evidence-checks-passed`.
- Final trusted-clock observation: `2026-10-08T08:36:22.848Z`,
  error bound `0.006206575` seconds. Envelope freshness passed before and after
  the cryptographic checks; this receipt does not extend its 15-minute lifetime.
- Approval, CI, migration evidence, both immutable registry manifests and all
  three real signatures passed in the installed unprivileged service.
- Temporary installation token revoked: `true`.
- `authorizing: false`, `replayLedgerVerified: false`, `deployed: false`.

Private audit record (three records, mode 0600):
`/var/lib/barber-staging-observer/1894204e-cf3c-4516-8145-8828eeb123fe.jsonl`.
SHA-256: `c2629869879e2d2abc3ad8656ee4cfcece3ba76be7fabea3f28b2b9ed9794cb0`.
This service-writable diagnostic audit is not an authoritative replay ledger.

The unit exited successfully, inactive/static, with no observer timer or
in-progress lock. Account UID 997/GID 985 still has only its own group.
All eight private backend containers remained running, all six health checks
healthy. Running container ID/name/image fingerprint remained
`97496dffd167cc0e68ddd2ab9b1bd157682f1b98fa2b695f0a31c354fd9e7c08`.
No deployment privilege, scheduler, root release policy, DNS, firewall,
frontend, database, integration or production change was made.

## Remaining gates

This completes the manual observer proof, not release acceptance. Do not reuse
this observation as deployment authorization, extend its expiry or approve a rerun.
Authoritative replay state, privileged workers, frontend deployment, routing,
backup/recovery acceptance and full Env3 acceptance remain separate work.
