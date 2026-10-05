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
