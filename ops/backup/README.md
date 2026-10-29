# Encrypted production recovery

This is production infrastructure for the existing backend VPS. It never runs in
local Test. Runtime credentials, PostgreSQL identity, authentication fingerprints,
backups and recovery evidence stay outside Git. The disabled configuration example
cannot activate backups without real, separately verified values.

## Components

- WAL-G 3.0.9 takes full PostgreSQL backups through the replication protocol and
  continuously archives streamed WAL. Client-side libsodium encryption is required.
- restic 0.19.1 encrypts and versions Storage, Functions and production configuration.
- A five-minute pulse creates a backup restore point, rotates WAL and downloads the
  exact archived segment into private RAM. Its SHA-256 must match the source.
- The readiness job checks the actual B2 key scope/private bucket, both remote
  catalogs, the repository binding, every WAL segment from the current full backup
  through the verified recovery point, the live slot and a completed real restore
  drill. It delegates the final decision to the unchanged release backup policy.

Binaries are pinned by SHA-256 in `runtime.py` and `config.example.json`. Obtain them
from the official [WAL-G release](https://github.com/wal-g/wal-g/releases/tag/v3.0.9)
and [restic release](https://github.com/restic/restic/releases/tag/v0.19.1).
WAL-G supports PostgreSQL replication-based backups and
[streamed WAL](https://github.com/wal-g/wal-g/blob/v3.0.9/docs/PostgreSQL.md);
restic documents [encrypted repositories](https://restic.readthedocs.io/en/stable/030_preparing_a_new_repo.html).
No PostgreSQL image change, database restart or public backup port is required.

## Protected installation

Only an approved operator installs these files. An incoming app release cannot
replace privileged backup tools. Run the maintained safety tests and review the
concrete source revision first.

| Path | Purpose |
|---|---|
| `/usr/local/lib/barber-backup/{runtime,readiness,scope}.py` | Root-owned reviewed code |
| `/var/lib/barber-release-backend/tools/` | Pinned backup executables |
| `/etc/barber-backup/config.json` | Actual production identity/scope, initially disabled |
| `/etc/barber-backup/b2.json` | Scoped B2 key, endpoint, bucket name and `production/v1/` prefix |
| `/etc/barber-backup/walg.key` | Random 32-byte key encoded in base64 |
| `/etc/barber-backup/restic.password` | Independent random 32-byte password encoded in hex |
| `/etc/barber-backup/postgres.password` | Dedicated random SCRAM password encoded in hex |
| `/etc/barber-backup/original-pg_hba.conf` | Original authentication rules for narrow rollback |
| `/var/lib/barber-backup/` | Repository binding, successful operation receipts and drill proof |
| `/etc/barber-release/backup-readiness.json` | Measured evidence consumed by the strict release gate |

Directories and secret files are root-only (0700/0600). Never put secrets in shell
arguments, public logs, Git, GitHub secrets, frontend runtime configuration or Test.
Each service pins the production PostgreSQL content ID and system identifier.

Create only `barber_backup`, with LOGIN, REPLICATION and `pg_read_all_settings`.
It must have NOSUPERUSER, NOBYPASSRLS, NOCREATEDB and NOCREATEROLE and no application
SQL grants. Physical replication can read the entire database by design. Supply
a fresh random password privately through standard input, and refuse an existing
role or slot until ownership is reconciled.

Prepend this exact block after matching the original HBA fingerprint:

```text
# BEGIN Barber backup local-only authentication
local replication barber_backup scram-sha-256
local postgres barber_backup scram-sha-256
# END Barber backup local-only authentication
```

Preserve every following byte. Validate `pg_hba_file_rules`, reload and verify the
old administrator, correct backup password and wrong-password rejection. Roll back
only the new block if verification fails. The current HBA is in the container
layer: a separately planned PostgreSQL container recreation must reapply and
verify this block. Ordinary frontend/Auth/Functions releases do not recreate PG.
The runner refuses unexpected authentication or database identity rather than
silently rewriting it.

Verify actual B2 authentication and the exact private bucket before initializing:

- `production/v1/pg17-<system identifier>/` for database/WAL.
- `production/v1/objects-v1/` for files.

Verify both prefixes are unused. Never initialize over existing repository data.
Record the restic repository ID and PostgreSQL identifier in root-owned
`repository-binding.json`. Enable the protected configuration only after this
review. Create no public ACL or bucket lifecycle change.

## Start and verify

Install the units, validate them with `systemd-analyze verify`, then reload systemd.
Start `barber-backup-stream.service`, verify its physical slot is active, and run
`barber-backup-full.service`, `barber-backup-objects.service` and
`barber-backup-pulse.service`. A failed or partial command cannot refresh a prior
successful receipt. Preserve the existing daily backup service.

After those first operations succeed, enable the stream and full/objects/pulse
timers. Full backups run daily at 03:15 UTC; objects and WAL pulses run five minutes
after the previous job completes. They are serialized per operation and limited
in CPU/memory/I/O. The current 512 MB slot retention setting remains unchanged;
monitoring blocks at 384 MB or a lost slot. Reconcile a lost slot and establish a
new verified full baseline; never silently discard a WAL gap.

Perform a real B2 restore drill before enabling the readiness timer. Download the
specific full backup, every required WAL segment and the specific file snapshot
into an isolated RAM target on the original backend. Use the exact PostgreSQL
image, zero network/ports, cron disabled and no outbound worker. Restore through
the verified LSN. Verify database identity, Auth, RLS, schema owners/ACLs, Storage,
Functions and configuration, then remove the container and all plaintext. Retain
only aggregate proof and actual timings in `restore-drill.json`. Production data
never enters local Test. The producer expects the measured proof fields from
`readiness.measured`; it cannot generate a restore PASS.

Run `readiness.py once` and the shared backup-policy CLI against the resulting
evidence. Only then enable `barber-backup-readiness.timer`. It refreshes every
minute. Failed checks write explicit blocked evidence; stale reports fail the
existing five-minute release check. Readiness does not enable application releases
or replace initial cutover acceptance.

## Recovery keys, retention and cost

Keep independent copies of the age identity and the age-encrypted archive of the
WAL-G/restic recovery keys. A Mac-only copy is insufficient. When using Apple
Passwords, save the single `AGE-SECRET-KEY-...` identity line as the secret; the
age-encrypted key archive can be stored separately in private cloud file storage.
That single line can later recreate an age identity file; comments are unnecessary.
Never upload the plaintext age identity or paste it into chat.

The initial installation retains existing backups and does not delete new
repository history automatically. Review a repository-specific retention policy
and measure actual storage before accepting unattended release operations. Never
prune a shared bucket or delete unrelated prefixes. The key expiry is reported in
measured evidence; rotate through a new read-only scope/privacy check before expiry.
Storage and restore traffic are billable according to the provider's current
prices; successful tests are not proof of free ongoing usage.

The October 29 initial real drill recovered the then-current small database and
file set in about 29 seconds from a point about 12 seconds old. This is evidence
for that dataset and isolated data recovery, not an uptime guarantee or a complete
11-service disaster-rebuild benchmark. Repeat after material platform/storage
changes and within the 92-day release policy window.

## Backup infrastructure rollback

Stop only the new backup units, stop their receiver and remove only the recorded
inactive physical slot. Restore the original HBA only when both the managed block
and original suffix still match. Reload and verify old access before removing the
new backup role/credential copies. Preserve encrypted backups and recovery keys.
Application rollback never overwrites live customer activity with a database backup.
