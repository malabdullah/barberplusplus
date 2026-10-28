# Production releases

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
a release artifact. `release.json` binds the source commit, workflow run,
frontend digest, backend archive digest, production runtime lock and ordered
migration hashes. The backend archive contains versioned Functions and migrations,
with environment files excluded.

Install `ops/release/controller.py` on the frontend VPS with root-owned config,
state and credentials. Its timer runs every 60 seconds; it exposes no HTTP port.
The GitHub read credential, registry pull credential and Dokploy key stay in
protected files on that VPS. Track and rotate credential expiry. The Dokploy key
has organization permissions because this Dokploy UI offers no per-app scope.

The backend SSH key must use a forced command invoking `ops/release/backend.py`,
with forwarding, PTY and user rc disabled. The helper has fixed database,
Functions and state paths. Only the reviewed adoption process may initialize
its migration/hash ledger. Automatic releases reject edits to applied migrations,
runtime changes, stale backup evidence and migrations outside the narrow reviewed
additive SQL subset. New tables, RLS changes, routines, backfills and destructive
SQL require a separately reviewed release.

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
Swarm image digest. An API acknowledgement alone is not deployment success.

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
