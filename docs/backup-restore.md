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

The historical recovery objectives were a 15-minute RPO and two-hour RTO. On 30 October 2026 the owner replaced continuous protection with one daily Backblaze cycle, accepting up to 24 hours of data loss. The following continuous-mode discussion describes the retired design. Daily backups
alone do not meet the RPO; continuous WAL/object protection and an independent
destination need verified operational evidence. Do not claim those objectives
are achieved until a timed drill establishes them. Monitor backup freshness,
recoverability, capacity and credential/key expiry.

A release must fail closed when fresh backup evidence is missing or stale.
The backend helper and `scripts/verify-backup-readiness.sh` share
`ops/release/backup_policy.py`; install that module alongside the backend helper.
Evidence uses the structure in `docs/backup-readiness-example.json`, including
verified WAL, base/object backups and database/Storage restoration. A fresh report
or a generic PASS/restore summary alone cannot satisfy the release gate. Report
actual recovery ages; refreshing a report must never refresh a backup's age.
Automatic frontend/Functions rollback preserves customer writes and never blindly
restores a database backup. Disaster recovery is a separate operator procedure.


The 2026-10-29 implementation adds encrypted B2 physical/WAL and file backups;
see [the production recovery runbook](../ops/backup/README.md). Daily full backups,
continuous streamed WAL, five-minute file snapshots and measured readiness use
pinned tools on the existing backend. A real isolated B2 recovery drill verified
database/Storage/Functions/configuration and cleanup. Readiness still requires
fresh measured evidence, initial release acceptance and operational review of
retention and independently accessible recovery keys. Historical same-host
plaintext backup findings above describe the earlier audit, not the new off-host
protection. Existing backups are preserved.

## Current daily policy (30 October 2026)

One `barber-backup-daily.timer` runs at 00:15 UTC (03:15 Kuwait), after Backblaze
free transaction allowances reset. A short-lived WAL receiver protects the one
full physical database backup; the same cycle captures Storage, Functions and
configuration, restores those exact encrypted off-site copies in an isolated
no-network PostgreSQL container, and removes the disposable plaintext target.
The receiver stops and its exclusive physical slot is dropped even on failure.
There is no continuous WAL stream between daily backups. No R2 schedules remain.
Existing B2/R2 archives and recovery keys are preserved; this change deletes none.

The release gate reads the original successful daily receipt locally, with a
26-hour freshness allowance for scheduling and completion. It fails closed for
missing, future, stale, wrong-system or incomplete restoration proof, without
requesting Backblaze catalogs every deployment minute. Failed backup runs never
refresh successful evidence. Recovery can lose up to 24 hours of customer changes.

For this approved transition only, the operator may bind the actual fresh R2
restoration receipt to one exact main commit, expiring no later than 26 hours
after capture. This is identified as `r2-transition`, never a B2 success. It
cannot authorize another commit, renew its own timestamp or make a failed B2 run
pass. Subsequent releases require a successful daily B2 receipt.

Do not promise the account-wide free limits will hold until a complete daily
cycle succeeds and usage is observed. Other applications can consume the same
allowance. No caps, billing settings, automatic retention deletions or backup
objects are changed by this release.
