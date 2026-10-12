# Backup, Restore, and Monitoring

## Production target

Production is designed for a 15-minute RPO and two-hour RTO. Configure encrypted
continuous PostgreSQL WAL archiving plus daily base backups, and independent
object Storage backups. The destination must be outside the production VPS
failure domain. Keep 30 daily copies and 12 monthly copies.

Monitor backup freshness, WAL archival lag/failure, restore-point age, and
destination capacity from an external service. The production promotion workflow
must query an authenticated endpoint that fails unless the newest recoverable
point is within 15 minutes and the latest base/object backup is healthy.

The endpoint returns JSON matching `docs/backup-readiness-example.json`. CI
rejects evidence older than five minutes, WAL or recoverable-point age above 15
minutes, base/object backups older than 25 hours, a non-off-site destination, or
a restore drill older than 92 days or exceeding the RPO/RTO. Do not include
credentials, object names, customer records, or raw backup logs in this response.

## Quarterly restore drill

1. Provision an isolated host from current infrastructure documentation.
2. Restore the selected base backup and replay WAL to the declared timestamp.
3. Restore object Storage to isolated volumes.
4. rotate JWT, database, Vault, SMTP, WhatsApp, and deployment credentials;
5. run schema checks and non-destructive role journeys;
6. record achieved RPO/RTO, missing objects, errors, and corrective owners; and
7. destroy the drill environment after evidence and encrypted logs are retained.

Hosted non-production is now **Test**, with `staging` retained as the technical
identifier. Its superseding policy uses manual encrypted, Mac-verified
checkpoints before stateful changes, retains the latest two verified points
plus incident/rollback points, and enables no automatic pruning. Preserve all
existing archives during the transition. See [Test operations](test-environment-runbook.md).
Local and disposable rehearsals use migrations and synthetic fixtures; resetting
shared Test still needs explicit resource-specific approval.

The selected production destination and pending implementation gates are in
[production backup preparation](production-owner-backup-plan-2026-10-12.md).
Neither Test's lighter policy nor provider selection changes the production
recovery requirements above.

## Monitoring

Probe frontend, Auth, REST, Realtime, Storage, and Edge Functions. Alert on
PostgreSQL connections, CPU, memory, disk, certificates, backups, deploys,
migrations, cron, email, WhatsApp, authentication failures, and application
errors. Tag logs with `environment`, redact credentials and personal data, and
send alerts through a service independent of Barber++.
