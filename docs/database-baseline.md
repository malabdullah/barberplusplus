# Authoritative Database Baseline

The checked-in legacy migrations do not recreate all tables used by the app.
They must not be deleted or marked as applied until this procedure succeeds.

## Verification record — 2026-09-03

- Production PostgreSQL `17.6` schema metadata was streamed into the isolated
  database-only local lab; no table rows, Auth users, Storage objects, Vault
  values, or credentials were copied.
- Production and the isolated restore matched exactly after normalization:
  SHA-256 `5d8a9963d8298c7174f1558e50d9e03e90c8c4e3790598b1f85c38691422e929`.
- Both sides contained 20 public tables, 90 indexes, 24 public functions,
  113 public policies, 17 application triggers, and RLS on all 20 tables.
- The checked-in baseline replay matched the approved production `public` and
  custom `secure` schemas, including grants: SHA-256
  `32929f3c0d468f6e190cbbe00846e57048137d6e3fb28fd93143e52833434afa`.
- A clean replay of the baseline and both subsequent migrations succeeded.
  Four deterministic synthetic Auth roles and fixtures in all 20 public tables
  loaded successfully; all 15 pgTAP security assertions passed.
- This is a schema-only baseline rehearsal. It does not replace the separate
  production database/Storage restore drill required before production
  promotion.

## Capture

1. Freeze production schema changes and record the maintenance window.
2. Verify an encrypted backup and perform a restore into an isolated validation
   host. Do not use the live database for baseline experiments.
   For a no-cost local validation host, run
   `scripts/prepare-baseline-local.sh`. It creates a separate ignored Supabase
   project under `.baseline-local/`, verifies that its database URL resolves to
   loopback, and writes only non-secret container metadata to the ignored
   `.env.baseline.local` file. Stop it with
   `scripts/stop-baseline-local.sh`. Docker Desktop should have at least 8 GB
   of memory assigned. The lab starts only PostgreSQL, attaches it to a
   dedicated Docker network, and denies non-loopback database clients in the
   active PostgreSQL HBA file; API, Studio, Auth, Storage, Realtime, mail, and
   analytics services stay off. Restore and inventory commands must use
   `docker exec` rather than the published host port.
   This target starts empty by design; do not connect it to production or treat
   it as authoritative until a reviewed schema-only backup has been restored
   and inventoried.
3. Pin the local PostgreSQL/Supabase versions to the versions actually running
   in production. Do not combine a PG15-to-PG17 upgrade with this baseline.
4. Run `scripts/capture-baseline-candidate.sh /absolute/safe/path.sql` with
   `PRODUCTION_DB_URL` and `ALLOW_SCHEMA_CAPTURE=yes` to capture application
   DDL. Separately inventory extensions, grants, Auth hooks,
   RLS, Storage buckets/policies, Realtime publications, Vault secret *names*,
   and cron definitions. Never export Vault values, credentials, or records.
5. Create the baseline filename with `npx supabase migration new baseline` and
   consolidate the reviewed DDL into that generated file.
6. Confirm the baseline contains tables, indexes, constraints, triggers,
   functions, explicit grants, RLS policies (including update `USING` and
   `WITH CHECK`), Storage policies, publications, and cron definitions.

## Prove

1. Move the incomplete legacy SQL files outside `supabase/migrations/` on a
   review branch, leaving the baseline plus subsequent migrations.
2. Run `npx supabase db reset --local` repeatedly from an empty local stack.
3. Add deterministic synthetic users and fixtures for admin, manager, agent,
   barber, customers, branches, services, bookings, notifications, messaging,
   and every primary workflow to `supabase/seed.sql`.
4. Add pgTAP tests under `supabase/tests/` covering tenant/branch/owner denial,
   trusted roles, constraints, triggers, functions, Storage, and Realtime.
5. Compare the rebuilt schema with the restored authoritative schema. Resolve
   all drift and have the migration/security review approved.
6. Save the normalized approved dump as `supabase/schema.expected.sql`; CI uses
   it to reject drift from the migration-produced database.
7. Commit `supabase/.baseline-ready`. This deliberately enables database replay
   and deployments in GitHub Actions.

## Adopt safely

Repair production migration history so the approved baseline is recorded as
already applied; never execute the baseline against production. Rehearse the
exact repair on the isolated restore first. Apply only later backward-compatible
migrations. Force user session refresh/reauthentication after trusted role claims
move to `app_metadata`.

Production promotion enforces this condition before even previewing a migration:
`scripts/verify-production-migration-history.sh` requires the repaired baseline
on both sides of the CLI history and rejects every unknown remote-only version.
The sanitized version-only result is retained with the dry-run artifact.

All future migrations must be created with `npx supabase migration new <name>`.
Use expand/migrate/contract releases for destructive changes and never delete a
column or constraint in the same release that stops using it.
