# Staging VPS Deployment Adapter Contract (Proposed v1)

Status: proposal for Env3 and owner review. These paths and schemas are not yet
approved or implemented. The staging workflow must remain fail-closed.

## Common rules

Each adapter runs locally on the staging VPS through a dedicated, unprivileged
server-side deployment identity, not a GitHub self-hosted runner registered to
the current public repository. Inputs and outputs exposed to GitHub are
non-secret release identifiers, immutable image digests, evidence paths, and
SHA-256 checksums only.
Adapters resolve runtime credentials from owner-controlled local configuration,
never from command-line arguments, and must not print secrets or backup data.

The deployment identity cannot directly use `sudo`, the Docker socket, or database operator
credentials. Privileged operations require a separately reviewed, root-owned
broker with a fixed protocol. The broker must expose only named staging
operations, validate every identifier/digest/path against an allowlist, use
fixed root-owned executable code and configuration, and return sanitized
evidence. It must not expose arbitrary commands, arguments, filesystem paths,
Docker API access, or deployment-identity-editable privileged scripts. A broad Dokploy owner
token is not an acceptable substitute.

Every adapter accepts `DEPLOY_SHA`, `FRONTEND_IMAGE`, `FUNCTIONS_IMAGE`, and a
broker-issued evidence identifier. The deployment identity never supplies an arbitrary
output path. The broker writes evidence beneath the fixed root-owned
`/var/lib/barber-staging/evidence/<commit>/` tree and returns only its identifier
and checksum. It refuses mutable images, production identifiers, missing
baseline readiness, an unexpected migration tree, symlinks, or a pre-existing
output. Evidence uses schema identifier
`barber-staging-deployment-evidence/v1`.

## Proposed constrained broker

The minimum broker design is a root-owned systemd service listening on
`/run/barber-staging-broker.sock`. The socket is `0660 root:barber-staging-release`;
only the dedicated deployment account belongs to that group. The executable lives
under `/usr/local/libexec/`, configuration under `/etc/barber-staging-broker/`,
and both are non-writable by the deployment identity. The service authenticates the Unix peer
credentials and accepts a versioned JSON request with only these operations:

- `status.inspect` — sanitized isolated-stack and bootstrap readiness;
- `backup.capture` — fixed quiesce/capture/resume sequence and evidence output;
- `migration.apply` — verified history, dry-run, then `--skip-vault` apply tied
  to matching backup evidence; and
- `images.rollback` — restore only previously recorded immutable application
  digests and run fixed health checks.

The service chooses every command, container/resource name, credential file,
and filesystem path. Requests cannot contain commands, executable paths, Docker
arguments, database URLs, secret values, or paths outside the fixed evidence
tree. Bootstrap is deliberately not exposed as an automation operation; the
owner executes the reviewed first-provisioning procedure separately.

## Approved-release pull protocol (proposed v1)

The current public repository uses GitHub-hosted CI only. After successful CI
for a same-repository push to protected `main`, a GitHub-hosted job referencing
the protected `staging` environment waits for the owner's release-specific
approval. Only that post-approval job may create a release-request artifact.
It receives no Dokploy, server, database, or broker credential.

Workflow permissions remain read-only by default. The build job alone receives
`packages: write`; it receives no OIDC token or attestation permission. The
post-approval evidence job alone receives `id-token: write` and
`attestations: write`, declares `environment: staging`, performs no checkout,
and cannot publish or deploy an image. The allowlisted workflow blob must retain
this separation.

The server-side pull service makes outbound requests to GitHub. It exposes no
public webhook or command endpoint and never accepts a pushed request. Its
GitHub identity is repository-scoped and read-only: Metadata, Contents, Actions
run/job/artifact evidence, and Attestations. GHCR image pulling uses a separate
package-read identity stored in Dokploy. The pull identity cannot write source,
workflows, checks, deployments, packages, or repository policy.

GitHub sources for this design:

- [OIDC security hardening](https://docs.github.com/en/actions/concepts/security/openid-connect)
- [Artifact attestations](https://docs.github.com/en/actions/concepts/security/artifact-attestations)
- [Actions artifacts REST API](https://docs.github.com/en/rest/actions/artifacts)
- [Workflow runs REST API](https://docs.github.com/en/rest/actions/workflow-runs)

### Release-request envelope

The artifact contains exactly a bounded JSON envelope and its GitHub/Sigstore
attestation bundle. Archives with extra entries, links, traversal, duplicate
names, unbounded data, or non-regular files are rejected. The envelope is at
most 16 KiB, uses schema `barber-staging-release-request/v1`, has no unknown
fields, and contains only:

- action `deploy-staging`, repository numeric ID and exact `owner/name`;
- workflow path plus the allowlisted workflow blob SHA;
- source CI run ID/attempt and release-request run ID/attempt;
- full lowercase 40-character commit SHA and branch `main`;
- exact frontend and Functions GHCR repositories plus 64-character SHA-256
  digests—never tags;
- migration-tree SHA-256 and latest migration identifier;
- environment `staging` and expected staging origins;
- UTC `issued_at` and `expires_at` no more than 15 minutes apart; and
- a cryptographically random 128-bit nonce and derived request ID
  `<repository-id>:<run-id>:<attempt>:<nonce>`.

The post-approval job attests the envelope digest and both image subjects using
GitHub OIDC/artifact attestations. The server verifies the attestation issuer,
repository owner and numeric repository ID, protected workflow identity, main
branch/ref, commit, `staging` environment-bound subject/claims, subject names,
and subject digests. A valid signature alone is insufficient; all GitHub
metadata and local allowlists below must also pass.

### Server verification

Before any broker request, the pull service independently verifies through the
GitHub API that:

1. The release-request run used the allowlisted workflow path and blob SHA,
   originated from the expected repository, targeted `main`, used the envelope
   commit, and completed successfully.
2. The named source CI run is the successful same-repository `push` run for that
   commit and workflow attempt.
3. The attestation was issued by the only OIDC-enabled post-approval job in the
   workflow revision, and its claims bind it to environment `staging`. The
   reviewed definition references `environment: staging`; any workflow blob
   change requires an out-of-band allowlist update and review.
4. Both GHCR manifests exist at the exact digests, their attestations match the
   envelope and commit, and no mutable tag is used for deployment.
5. The baseline marker, migration-tree evidence, repository/environment IDs,
   origins, timestamps, and all fixed constants match the reviewed local policy.
6. Server time is synchronized, the request is not expired or from the future,
   and its request ID, run attempt, nonce, commit/digest tuple, and artifact ID
   have never been accepted before.

The service downloads no source archive, performs no checkout, evaluates no
repository script, and treats every envelope value as data. It maps the validated
fixed action to the broker's fixed operations; the request cannot name commands,
services, containers, hosts, paths, environment variables, or credentials.

### Replay and state handling

The pull service and root-owned broker maintain independent append-only ledgers.
Acceptance moves a request atomically through `observed`, `verified`,
`authorized`, `executing`, then `consumed` or terminal `failed`. A request ID,
run attempt, nonce, artifact ID, or exact commit/digest tuple already present in
either ledger cannot start another deployment. Process restart resumes evidence
inspection but never repeats a side effect automatically. Retry requires a new
owner-approved workflow attempt, nonce, expiry, and request ID. Rollback uses
the separately recorded previous immutable digests and is never represented as
a replay of the rejected request.

Expiry is checked once before broker authorization and again immediately before
the first side effect. Expiry during an already-started fixed broker transaction
does not interrupt recovery; the broker finishes or rolls back according to its
local state machine and records terminal evidence.

### Smallest safe first installation stage

Install only an observation-mode pull verifier under a dedicated unprivileged
account. It has no broker-socket group membership, Dokploy/API key, GHCR pull
credential, Docker access, database access, `sudo`, deployment action, or inbound
listener. `STAGING_VPS_AUTOMATION_READY` remains false and the checked-in
workflow remains deliberately stopped.

The observation service may read only public repository metadata plus synthetic
local protocol fixtures initially. After a separate approval for a repository-
scoped read identity, it may poll and validate deliberately non-deployable test
envelopes, write sanitized decisions to its own state directory, and prove
expiry/replay/restart behavior. Broker socket access and real approved-release
consumption are later stages requiring their own review and explicit approval.

## Proposed adapter paths

### First provisioning (separate gate)

The first creation of the currently absent staging stack is bootstrap, not a
normal release. It requires an explicit owner-approved bootstrap plan, empty
Database/Storage/Vault proof, isolated resource and hostname checks, baseline
and migration verification, initial fixture approval, and a post-bootstrap
backup plus restore rehearsal. It must not invent prior-backup evidence for a
stack that did not exist. `STAGING_VPS_AUTOMATION_READY` remains false until
bootstrap evidence and the first accepted release are independently recorded.

### `scripts/staging-vps-backup-adapter.sh`

The adapter must quiesce the isolated staging workload and capture Database,
Auth, Vault, Storage objects, encrypted runtime configuration, and the complete
PostgreSQL `db-config` volume. The latter includes
`/etc/postgresql-custom/pgsodium_root.key`; `VAULT_ENC_KEY` or a database dump
alone cannot restore Vault. The `db-config` archive must be encrypted separately,
bound to the same release evidence, and restored before the target PostgreSQL
service starts. Its evidence records the release identifiers, migration-tree
hash, component checksums and sizes, capture time, encrypted off-VPS receipt
confirmation, root-key-volume restoration order, and successful Vault-inclusive
restore-rehearsal evidence reference. It returns success only after every
component, off-VPS receipt, and restore verification passes.

Storage backup and extraction must use a reviewed pinned GNU tar implementation
with `--xattrs`, `--xattrs-include=user.*`, `--acls`, and `--numeric-owner` while
the relevant services are stopped. A plain file copy is invalid because it can
lose the file-backend content-type, cache-control, ETag, ownership, and related
extended attributes. Recovery evidence must verify private object bytes and
metadata through the Storage API, including expected content type, cache-control,
ETag behavior, authenticated access, and anonymous denial. Capture and restore
must use isolated internal networks, no published restore ports, and newly
created labeled target volumes.

An encrypted transfer by itself is not a verified backup. Existing probe/pull
helpers and a successful synthetic local restore do not satisfy live VPS backup
acceptance; live evidence remains a separate gate.

### `scripts/staging-vps-migration-adapter.sh`

The adapter verifies applied migration history and the approved baseline,
records an exact dry-run, and then applies only the reviewed release migrations
with `--skip-vault`. It must never reset or seed a nonempty environment. Evidence
records before/after migration-tree hashes, dry-run checksum, applied migration
names, command outcome, and completion time. It refuses to run unless verified
backup evidence for the same release and image digests is supplied through
`BACKUP_EVIDENCE`.

### `scripts/staging-vps-rollback-adapter.sh`

The adapter restores the retained previous immutable frontend and Functions
digests through Dokploy and verifies their health. It never runs a destructive
database downgrade. Database failures require a reviewed forward fix or the
separate recovery procedure using verified backup evidence. Its evidence records
the rejected and restored digests, health results, timestamps, and any explicit
recovery-evidence reference.

## Review and activation gates

Before these proposed names become workflow dependencies:

1. Env3 implements and locally validates the adapters and JSON schemas.
2. A reviewed root-owned constrained broker provides only the exact privileged
   staging operations required by the adapters; its API, allowlists, ownership,
   and audit output are tested independently.
3. The isolated live stack passes backup, restore, migration, and recovery
   rehearsal without production data or credentials.
4. Every pinned AMD64 runtime image passes the approved security threshold; any
   unresolved High or Critical finding keeps the stack blocked.
5. The owner reviews the implementation and a separate first-bootstrap plan.
6. A dedicated Dokploy identity/token is limited to the Barber++ staging project
   and only application/compose read, update, and deploy operations.
7. The server-side deployment identity has no Docker-group or sudo privilege.
   No self-hosted runner is registered to the current public repository. A
   future organization workflow-restricted group or private deployment
   repository requires separate approval.
8. `STAGING_VPS_AUTOMATION_READY` is set to `true` only after all evidence is
   recorded. Environment approval is still required for each release.
