# Staging VPS Deployment Adapter Contract (Proposed v1)

Status: proposal for Env3 and owner review. These paths and schemas are not yet
approved or implemented. The staging workflow must remain fail-closed.

## Common rules

Each adapter runs locally on the staging VPS through a dedicated, unprivileged
release runner. Inputs and outputs exposed to GitHub are non-secret release
identifiers, immutable image digests, evidence paths, and SHA-256 checksums only.
Adapters resolve runtime credentials from owner-controlled local configuration,
never from command-line arguments, and must not print secrets or backup data.

The runner cannot directly use `sudo`, the Docker socket, or database operator
credentials. Privileged operations require a separately reviewed, root-owned
broker with a fixed protocol. The broker must expose only named staging
operations, validate every identifier/digest/path against an allowlist, use
fixed root-owned executable code and configuration, and return sanitized
evidence. It must not expose arbitrary commands, arguments, filesystem paths,
Docker API access, or runner-editable privileged scripts. A broad Dokploy owner
token is not an acceptable substitute.

Every adapter accepts `DEPLOY_SHA`, `FRONTEND_IMAGE`, `FUNCTIONS_IMAGE`, and a
broker-issued evidence identifier. The runner never supplies an arbitrary
output path. The broker writes evidence beneath the fixed root-owned
`/var/lib/barber-staging/evidence/<commit>/` tree and returns only its identifier
and checksum. It refuses mutable images, production identifiers, missing
baseline readiness, an unexpected migration tree, symlinks, or a pre-existing
output. Evidence uses schema identifier
`barber-staging-deployment-evidence/v1`.

## Proposed constrained broker

The minimum broker design is a root-owned systemd service listening on
`/run/barber-staging-broker.sock`. The socket is `0660 root:barber-staging-release`;
only the dedicated runner account belongs to that group. The executable lives
under `/usr/local/libexec/`, configuration under `/etc/barber-staging-broker/`,
and both are non-writable by the runner. The service authenticates the Unix peer
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

An encrypted transfer by itself is not a verified backup. Existing probe/pull
helpers and local restore tests do not satisfy this contract.

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
7. The dedicated repository runner has no Docker-group or sudo privilege and is
   never eligible for pull-request jobs.
8. `STAGING_VPS_AUTOMATION_READY` is set to `true` only after all evidence is
   recorded. Environment approval is still required for each release.
