# Existing production database adoption

Local Test replays the committed baseline and subsequent migrations, using
synthetic data only. Production already contains customer tables and has no
Supabase migration-history table as of the 2026-10-28 audit. Never replay the
baseline CREATE TABLE statements against that live database.

The reviewed initial adoption must:

1. Refresh schema-only metadata for public/private/secure schemas, Auth triggers,
   Storage policies, permissions, publications, extensions and cron.
2. Compare each migration's effects to the installed state. Preserve the original
   migration files and their hashes; distinguish applied effects from missing ones.
3. Rehearse the adopted baseline and exact pending SQL on an isolated database
   using the pinned production PostgreSQL image and no production rows.
4. Verify the synthetic replay, RLS tests and old/new frontend compatibility.
5. Verify production backup and restoration evidence, then obtain the initial
   concrete cutover review.
6. Apply required SQL transactionally and initialize both the Supabase migration
   history and a private ordered name/SHA-256 ledger in the same reviewed adoption.
   Record the resulting schema fingerprint. Never mark unapplied effects as applied.

The schema-only rehearsal executes the six post-baseline migrations
against the installed schema without rerunning baseline creation. Production
already has trusted app roles; no user-metadata role promotion is needed.
The newest migration adds the previously absent avatar ownership policies and
enforces the application's existing five-megabyte/image-type upload limits in
Storage. It preserves existing objects and requires the initial cutover review.
The full comparison retains production documentation comments and an equivalent
rate-limit policy role ordering difference. Behavioral comparison may ignore only
parsed top-level COMMENT statements and that exact reviewed role list; it must
preserve every SQL function body and literal.

The release helper refuses an absent/unaccepted baseline, a changed migration
prefix, unexpected runtime images or unreviewed SQL. Platform upgrades and
destructive schema changes require a separately planned release.
