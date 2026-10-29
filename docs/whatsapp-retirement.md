# WhatsApp retirement and production release

The development change removes WhatsApp screens, delivery workers and integration
settings. The future customer iOS/Android app and a separate staff app are not
implemented by this change. Existing staff booking and customer workflows remain.

The migration unschedules the WhatsApp reminder job and removes the two booking
reminder triggers. It does not delete or update customer, booking, reminder,
message or conversation records. Existing historical tables, their access
policies, old migration files and the legacy `whatsapp_agent` booking actor value
remain for data integrity and compatibility; the UI labels that actor Agent.

Production delivery requires a separately reviewed release. The automatic
controller intentionally rejects the migration: do not merge this change to main
expecting an automatic deployment or bypass its safety check. Before cutover:

1. Confirm fresh database and Storage backups and recovery evidence, production
   runtime health and the exact applied migration hashes; keep WhatsApp delivery
   paused. Record current customer and historical reminder row counts without
   exporting customer data.
2. Rehearse the exact migration and worker replacement on the pinned production
   runtime using synthetic data, including the existing-reminder test, and review
   the exact transaction, ledger update, release identity and rollback steps.
3. Serialize and pause releases during the separately reviewed migration and
   Functions replacement. Preserve the previous frontend and Functions artifacts;
   never roll back by restoring a database over new customer writes.
4. Verify the job and triggers are absent, historical counts are preserved, the
   remaining Functions and booking flows work, and the deployed release is healthy.
   Only then resume routine coordinated releases.
5. Inventory any production Meta webhook registrations, credentials and routes.
   Retire only resources proven exclusive to this integration, after confirming
   the workers are no longer needed. Do not expose or print secret values.

The versioned migration and tests are in `supabase/migrations` and
`supabase/tests`. The production smoke must use authorized disposable records or
an owner-operated read-only session; production customer records are never test
fixtures.
