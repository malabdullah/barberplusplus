# Archived legacy migrations

These migrations are preserved for historical review but are not replayable as
a complete database history. Production did not contain a
`supabase_migrations.schema_migrations` table when the 2026-09-03 baseline was
captured.

The authoritative migration chain now begins with
`../migrations/20260901000000_baseline.sql`. Never move these files back into
`supabase/migrations/` or apply the baseline to production. Production adoption
must record the baseline and already-applied cutover migration as applied before
running later backward-compatible migrations.
