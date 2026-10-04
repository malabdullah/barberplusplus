# Staging VPS Deployment Adapter Contract (Proposed v1)

Status: proposal for Env3 and owner review. These paths and schemas are not yet
approved or implemented. The staging workflow must remain fail-closed.

## Common rules

Each adapter runs locally on the staging VPS through a dedicated, unprivileged
release runner. Inputs and outputs exposed to GitHub are non-secret release
identifiers, immutable image digests, evidence paths, and SHA-256 checksums only.
Adapters resolve runtime credentials from owner-controlled local configuration,
never from command-line arguments, and must not print secrets or backup data.

Every adapter accepts `DEPLOY_SHA`, `FRONTEND_IMAGE`, `FUNCTIONS_IMAGE`, and an
absolute `EVIDENCE_OUTPUT` path under a runner-owned evidence directory. It
refuses mutable images, production identifiers, missing baseline readiness, an
unexpected migration tree, symlinks, or a pre-existing output file. Evidence is
written atomically with mode `0600` and schema identifier
`barber-staging-deployment-evidence/v1`.

## Proposed adapter paths

### `scripts/staging-vps-backup-adapter.sh`

The adapter must quiesce the isolated staging workload and capture Database,
Auth, Vault, Storage objects, and encrypted runtime configuration. Its evidence
records the release identifiers, migration-tree hash, component checksums and
sizes, capture time, encrypted off-VPS receipt confirmation, and successful
restore-rehearsal evidence reference. It returns success only after all five
components, off-VPS receipt, and restore verification pass.

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
2. The isolated live stack passes backup, restore, migration, and recovery
   rehearsal without production data or credentials.
3. The owner reviews the implementation and a specific first-cutover plan.
4. A dedicated Dokploy identity/token is limited to the Barber++ staging project
   and only application/compose read, update, and deploy operations.
5. The dedicated repository runner has no Docker-group or sudo privilege and is
   never eligible for pull-request jobs.
6. `STAGING_VPS_AUTOMATION_READY` is set to `true` only after all evidence is
   recorded. Environment approval is still required for each release.
