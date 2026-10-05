# Staging VPS CI/CD Verifier Status

Status: implemented locally, automation disabled, not installed or activated.

This report binds the Env4 verifier work to the successful private bootstrap in
[`staging-private-bootstrap-execution.md`](staging-private-bootstrap-execution.md).
The bootstrap source is `c24f8ecadbe49d353965a0e9b457ebcd3cfca287` on host
`srv1207055`, project `barber-staging-private`, with the exact eight-service
inventory and four committed migrations recorded there. The Env3 handoff commit
is `2913fc1` on `codex/staging-completion`.

Nothing in this implementation deploys an application, changes public routing,
merges a branch, creates a version tag, or enables a broker mutation.

## Env3 integration review — October 5

Env4 commit `7acdf2ed1b3b691032f2df311ea38027fb3c322c` was fast-forwarded into
the staging completion feature branch; `main` and the Env4 checkout were not
changed. A separate AI code-review pass (not independent human review) found
and corrected these integration gaps:

- The verifier suite was missing from the application CI job; it now runs there.
- The bootstrap source must match the exact approved commit, not merely have
  the shape of a Git SHA.
- Adapter request IDs require this repository, first-attempt identity and a
  128-bit hexadecimal nonce. Empty, foreign-repository and rerun IDs are denied.
- Success replies must be canonical single-frame JSON with only the expected
  fields and the evidence prefix for that operation. Duplicate fields and a
  migration receipt presented as a backup receipt are denied. Broker-supplied
  error text is not echoed into operator logs.

Full local `npm run check` passed, including 64 verifier and 148 staging safety
tests. All 15 local browser journeys passed without resetting the development
database. A fresh synthetic frontend Docker build/runtime passed health, runtime
configuration, CSP, noindex, no-store, nosniff and UID 101 checks, with no network
or published ports. Local image:
`sha256:403bfff0e8bb8b7f5bc7bc41975ccdef24d20f93c86acb1146aec4671fbb0a1a`.
It is a review image, not a published or accepted release. Only its labelled
disposable container was removed; the image remains cached.

Read-only VPS checks confirmed `srv1207055`, active broker socket and
`NTP=yes` / `NTPSynchronized=yes`. Neither `gh` nor `chronyc` is installed.
The current Ubuntu `gh` candidate is 2.45.0, while the verifier requires the
modern attestation interface; installing the old package is not sufficient.
The official CLI release inspected was 2.102.0. A package-manager simulation
for Chrony 4.5-1ubuntu4.2 would add `tzdata-legacy` and replace
`systemd-timesyncd`; **no packages or clock services were changed**. This
clock-service replacement requires specific owner approval and post-install
synchronization/offset verification. A boolean NTP status does not satisfy the
verifier's bounded clock-error test.

Live GitHub protection still requires all five app-bound checks, strict updates,
PRs and administrator enforcement, with no force pushes/deletions. Staging still
requires owner approval and protected branches. No policy was changed.

### Remaining implementation, not just activation

The current modules are verification/request-building libraries, not an installed
end-to-end daemon. Still required: root-owned credential/runtime wiring, a
persistent crash-safe ledger writer/lock, a non-deploying real-evidence run,
and mutation-capable broker workers with independent authorization checks.
The one-time bootstrap capture operator cannot be reused for recurring backups
because its empty-Vault gate intentionally blocks repetition. Backup operations
need asynchronous job/status semantics or another reviewed bounded execution
protocol: the current five-second adapter deadline is not a valid backup timeout.
The three adapter requests also do not implement frontend/Functions deployment;
that fixed operation, first-release recovery and later rollback need explicit
design and tests before activation. Do not label these gaps as completed.

The next artifact-evidence stage needs a separately approved protected-main
merge to publish the first two images, followed by owner approval of the
non-deploying attestation job. That approval must not enable the broker, change
DNS/public routing or deploy a frontend. New GHCR packages default to private;
verify visibility before using them and never silently change it.
Sources: [official attest action](https://github.com/actions/attest),
[GHCR publication and visibility](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry).

## Implemented repository components

- `.github/workflows/deploy-staging.yml` builds the frontend and Functions
  images once from the successful `main` CI commit and publishes commit-SHA
  tags. It carries the resulting immutable registry digests into a protected
  `staging` environment job.
- The protected job has no checkout and no server, Dokploy, database, broker or
  package-write credential. It creates one canonical 15-minute release-request
  envelope, attests the envelope and both immutable image subjects with
  `actions/attest@v4`, and uploads exactly one deterministically named artifact.
- `scripts/staging-evidence-transport.mjs` reads only the selected GitHub run,
  approval history, environment policy, artifact, workflow source and exact
  commit's migrations. Its GHCR reader accepts only the two Barber++ image
  repositories and verifies the response body against the requested registry
  digest. A package-reader token, when required, is sent only to the exact GHCR
  token exchange and is never returned.
- `scripts/staging-attestation-verifier.mjs` supports online GitHub API lookup
  and offline bundles through the official `gh attestation verify` command. It
  enforces repository and owner IDs, workflow identity, main ref, commit,
  release run/attempt, GitHub-hosted runner, subject name and subject digest.
  Envelope and both image attestations remain separate required proofs.
- `scripts/staging-release-evidence.mjs` binds the canonical envelope, protected
  environment approval, successful same-repository protected-main CI run,
  artifact bytes, workflow blob, image manifests and attestations, exact
  four-migration tree, and replay identities into one non-authorizing SHA-256
  binding.
- `scripts/staging-vps-verifier.mjs` validates the fixed private-bootstrap
  policy, fresh bounded `chronyc tracking` evidence, a canonical append-only
  hash-chained replay ledger, and the exact broker capability set.
- `scripts/staging-vps-adapters.mjs` creates bounded JSON frames only for
  `backup.capture`, `migration.apply`, and `images.rollback`. Requests cannot
  contain a command, executable, path, database URL or mutable image. The
  adapter refuses before opening the broker socket while automation is disabled.

## Deliberately closed gates

The checked-in root policy is `ops/staging-vps/release-policy.json`. It has
`automationReady: false`, an empty reviewed-workflow allowlist, and the exact
Env3 host, project, install root, bootstrap source, services, repositories,
migration count and broker protocol.

The live broker remains observation-only. Its only active capability is
`status.inspect`; all mutations remain disabled. The new request adapters are
not installed on the VPS and the live broker has not been expanded. The named
GHCR packages have not yet supplied a live immutable-manifest and attestation
proof. Therefore the current decision is **NO-GO for activation or deployment**.

## Credentials and configuration

No server-side secret value belongs in GitHub. PR CI has no environment and
receives no staging or production secrets. The staging evidence job uses only
its job-scoped `GITHUB_TOKEN` with `contents: read`, `id-token: write`,
`attestations: write`, and `artifact-metadata: write`.

The already approved VPS evidence reader and package reader are documented in
[`staging-github-access.md`](staging-github-access.md). Their values remain in
root-owned encrypted systemd credentials on the VPS. The repository records
names and required capabilities only, never credential values.

## Remaining approval and activation steps

1. Merge only after code review and normal protected-branch checks. This work
   does not perform that merge.
2. Let a successful protected `main` CI run publish the first two GHCR images.
   Obtain release-specific `staging` environment approval for a new first
   attempt; do not approve a rerun attempt.
3. Run the observation verifier against that release and retain sanitized proof
   of the GitHub approval, three attestations, two immutable GHCR manifests,
   exact workflow blob, four-migration tree, trusted time and unused replay
   identity. This remains non-deploying.
4. Review the exact final workflow blob and add its Git blob SHA and independent
   SHA-256 to the root-owned policy allowlist.
5. Separately review and approve broker mutation implementation, installation,
   root ownership, peer authorization, backup capture, restore rehearsal,
   migration apply and rollback evidence. Private-bootstrap approval does not
   authorize these changes.
6. Only a later release-specific approval may set root-owned
   `automationReady: true`. Public ingress, DNS, Cloudflare and Dokploy routing
   remain separate approvals.

Production is outside this work. Do not create a semantic version tag or invoke
the production workflow. Production promotion must later resolve the accepted
staging digest and must not rebuild the image.

## Local validation

```sh
npm run test:staging-verifier
npm run test:cicd
npm run test:staging-broker
npm run test:staging-vps
```

Network, GitHub CLI, GHCR and broker boundaries use test doubles in these local
checks. Passing them proves fail-closed repository behavior, not a live GitHub
approval, published image, VPS activation or deployment.
