# Production releases

> **Maintained release procedure.** Initial cutover is a one-time historical
> adoption checklist, not setup for a new developer checkout. Reconcile the accepted
> private controller/ledger/runtime record before any release. Documentation Git
> commits can be ahead of the running application; see [handoff](handoff.md).

## Initial cutover

Do not enable automatic releases until all of these are evidenced for a concrete
commit and frontend image digest:

1. Adopt the existing database baseline without rerunning table creation.
   Rehearse the precise remaining migrations on the exact production PostgreSQL
   image with schema-only metadata and synthetic data. Record schema differences,
   including documentation-only differences. Verify Auth, Storage, permissions,
   triggers, Realtime publications and scheduled jobs separately.
2. Verify a fresh encrypted off-host production backup and a restoration drill
   in a dedicated isolated recovery target. Production data never enters Test.
3. Preserve and test the previous frontend and Functions artifacts. SQL rollback
   must preserve customer writes; never automatically restore an old database.
4. Configure one canonical Dokploy app and one HTTPS domain owner. Disable old
   direct GitHub hooks before publishing main, keeping management port 3000
   private. Verify production runtime configuration, Auth redirects and SPA routes.
5. Review the concrete cutover, execute it, and record actual health, running
   digest, commit identity and production smoke results in a root-owned acceptance
   record. Then enable the controller timer.

The first release is a controlled cutover. Existing customer data and Dokploy's
database are preserved. Never satisfy readiness by creating unevidenced PASS
records or modifying the required tests.

## Routine releases

Merge reviewed development work into main. GitHub runs application, database,
browser, dependency and secret checks before publishing one immutable image and
public prerelease assets. The package job alone receives temporary contents-write
permission; it creates a unique build-run/attempt tag at the exact commit and
publishes an attested ZIP containing only `release.json` and `backend.tar.gz`,
plus those two individually attested subjects. Existing assets are never overwritten.
`BARBER_RELEASE_VALIDATION=verified-v1` enables browser and database receipt reuse
for eligible frontend-only merges. The verifier checks the tested merge tree and
parents, the successful GitHub workflow attempt and exact suite steps, the
immutable receipt digest, and the complete runner fingerprint. The pinned
runner admission check requires the exact CPU fingerprint and image revision.
Each suite without a match runs its full checks. Application, dependency review,
secret scanning, packaging, image smoke tests and artifact verification are
required on every production release. Unset the variable or set it to `off` to
return both suites to full validation for future runs.

`BARBER_RELEASE_MEASURE_FIRST=true` starts a separate full validation comparison
for the same main commit while reuse is enabled. The comparison publishes timing
evidence only. It has no package or deployment job and the controller continues
to follow `release.yml`. Remove the measurement variable after collecting the
first comparison.

`release.json` binds the source commit, workflow run,
frontend digest, backend archive digest, production runtime lock and ordered
migration hashes. The backend archive contains the Deno lockfile, versioned
Functions bundled with frozen dependencies, and migrations. Environment files
are excluded. CI cold-starts the bundles on the pinned runtime with network
access disabled.

Install `ops/release/controller.py` on the frontend VPS with root-owned config,
state and credentials. Its timer runs every 60 seconds; it exposes no HTTP port.
The consumer uses anonymous public GitHub/GHCR downloads and verifies the release
identity, asset size/digest and GitHub/Sigstore attestations for the bundle, its
subjects and frontend image. It follows only reviewed HTTPS redirect hosts and
never forwards a GitHub credential. No persistent GitHub token is needed on the VPS.
The Dokploy key stays in a protected file; track and rotate its expiry. That key
has organization permissions because this Dokploy UI offers no per-app scope.

The backend SSH key must use a forced command invoking `ops/release/backend.py`,
with forwarding, PTY and user rc disabled. Install the reviewed root-owned
helper and a version of GitHub CLI supporting `gh attestation verify` on the
database server. The helper independently verifies the current main commit and
the archive's signed release-workflow attestation before staging. It records
the result in its private state and requires that receipt before preflight or
apply. Verify access to public GitHub and Sigstore endpoints during adoption.
The helper has fixed database,
Functions and state paths. Only the reviewed adoption process may initialize
its migration/hash ledger. Automatic releases reject edits to applied migrations,
runtime changes, containers without a successful health check, stale backup evidence and migrations outside the narrow reviewed
additive SQL subset. New tables, RLS changes, routines, backfills and destructive
SQL require a separately reviewed release.

The backend repeats readiness after applying SQL and Functions, before acknowledging
success. A service failure, schema/history drift or remaining migration at that
point blocks frontend deployment and enters the existing recovery path.

The initial adoption records the managed Function directories. Frontend-only
releases leave unchanged Functions running. Changed Functions are fully backed
up and staged before the runtime drains; the runtime then stops briefly while
the directories are replaced. The main gateway and protected configuration stay
outside managed application source. Rollback restores removed/changed workers
and removes newly introduced workers. A partial backup never authorizes deleting
a live worker. Account for this short Functions availability gap during release
planning.

The controller serializes delivery and flushes each journal phase to disk. Failed or interrupted
delivery stops future automatic advancement until an operator reconciles actual
remote state. Health verification checks HTTPS, the deployed commit and actual
Swarm task, running container and pulled image identities. A desired image in
the Swarm specification or an API acknowledgement alone is not deployment success.

## Recovery

For failure after backend application, restore compatible prior frontend and
Functions artifacts; retain committed SQL and customer writes. Verify the restored
release's health and digest. Record the incident and reconcile the private journal
before retrying. Never force-clear a failed state or reverse SQL automatically.

For an interrupted migration, inspect the transactional hash ledger before any
retry. For an interrupted Functions update, inspect the recorded prior code and
runtime state. Keep production secrets and the separately managed gateway out of
the release source archive. Do not upgrade Supabase/Dokploy as part of an app
release.


### Administrative password-reset guard

The admin password-reset feature requires a separately reviewed release of
`20261029114557_guard_admin_password_resets.sql` before deploying its Edge
Function and frontend. Rehearse the migration against the production baseline
and pinned database version, confirm current backups and restore evidence, and
verify the trigger and function permissions. Never reset the production database
to apply it. The guard can temporarily block role changes for accounts involved
in a reset.

If the reset reports an uncertain result, do not retry blindly or automatically
expire the guard: the Auth request may still complete. An operator must first
verify that the original request and Auth operation have finished, investigate
the requested/completed audit records without exposing passwords, and coordinate
a fresh credential with the affected user. Only after the operation is known to
have stopped may an authorized operator remove the specific stale guard through
a separately reviewed, targeted maintenance action. Do not delete unrelated
guards or audit records.

Run `node scripts/test-admin-reset-concurrency.cjs` from a running local Test
checkout to exercise both competing role-change orderings. The script checks the
local API address and creates and removes only disposable local accounts.

### Customer checkout release handoff

When publishing the customer booking sign-in/guest flow, complete the pending
production-to-iOS handoff in [Customer booking checkout](customer-booking-checkout.md#pending-production-handoff)
after successful production verification. The owner authorized that notification
after publication; Test deployment alone does not trigger it.
