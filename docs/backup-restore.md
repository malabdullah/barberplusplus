# Production backup and restoration

Production backups are separate from disposable local Test and retired workloads.
The permanent-discard policy for n8n/Ollama/old Test does not apply to production
Supabase or Dokploy's own database.

The existing backend backup service writes database, roles and
config/Storage/Functions archives. Inspection on 2026-10-28 found plaintext
root-only copies on the same VPS. A scheduled job and file existence alone do not
prove encryption, off-host recovery or successful restoration.

Before initial cutover, verify source checksums and a fresh encrypted off-host
copy, then restore it in a dedicated isolated recovery container/host. Disable
network access, cron and outbound integrations during the drill. Validate database
integrity, Auth records, Storage objects, Functions and relevant configuration.
Retain aggregate evidence only; never publish customer records or credentials.

Keep encryption identities outside Git and Test, with a separately protected
recovery copy. Document who can recover the encryption key if the Mac or VPS is
lost. Encrypt before retaining or transferring off-host data. Never put backups
in a public repository or a publicly accessible bucket.

The target recovery objectives are a 15-minute RPO and two-hour RTO. Daily backups
alone do not meet the RPO; continuous WAL/object protection and an independent
destination need verified operational evidence. Do not claim those objectives
are achieved until a timed drill establishes them. Monitor backup freshness,
recoverability, capacity and credential/key expiry.

A release must fail closed when fresh backup evidence is missing or stale.
Automatic frontend/Functions rollback preserves customer writes and never blindly
restores a database backup. Disaster recovery is a separate operator procedure.
