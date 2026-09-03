# Legacy Decommission Checklist

Start this checklist only after the first controlled production release has been
healthy for 72 hours. The active production database, Storage, and customer data
are never cleanup targets.

- Inventory traffic, callbacks, schedules, DNS, TLS routes, redirect URLs,
  containers, volumes, images, networks, Vault entries, and credentials.
- Verify the current digest, migration version, backup freshness, rollback
  digest, and a final encrypted backup.
- Remove the superseded frontend deployment and old Dokploy build configuration.
- Remove only confirmed-unused containers, images, networks, and frontend volumes.
- Remove obsolete cron jobs and Vault entries.
- Revoke old publishable, service-role, webhook, provider, and deploy credentials.
- Remove stale DNS, OAuth redirects, webhook registrations, and TLS routes.
- Prove the former hosted Supabase project receives no requests, callbacks,
  files, or jobs before removing references.
- Delete former database or Storage resources only with explicit inventory
  approval; retain the final backup under the production policy.
- Search code, CI, documentation, DNS, Dokploy, cron, and integrations for every
  old implementation identifier and attach zero-result evidence to the change.
