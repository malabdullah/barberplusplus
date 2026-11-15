# Post-backup verification plan — not executed

Prepared 14 November 2026 from local source and saved receipts only. Setup receipt
SHA256 `94860601933ab75382c5eb00c4d1001c2c7554a90787d373918875570795d045`
records successful installation at **14 November, 11:25:21 AM Kuwait**
(`2026-11-14T08:25:21Z`). All three deletion switches remain OFF. Access is closed.
The next scheduled genuine daily backup is **15 November, 3:15 AM Kuwait**
(`2026-11-15T00:15:00Z`). Its start time is not evidence of successful completion.

## A. On-server selected-file recovery proof

Requires a separate concrete approval after the genuine backup finishes. Review
the fixed executor and existing sources again before asking; this plan supplies
no new server access, backup credentials, commands or fixture authorization.

1. Obtain one fresh database-only IP/32 SSH window with a verified restoration
   path and bounded deadlines. Do not reopen frontend access or retain overnight
   SSH. Use existing keys and strict host verification; restore immediately.
2. Read the original successful `/etc/barber-release/backup-readiness.json` in
   server memory, without rewriting it. Apply unchanged `ops/release/backup_policy.py`:
   daily-v1/B2, actual current system/repository binding, all restoration flags,
   capture/verification order and 26-hour freshness. Require capture after the
   actual installation above. The 14 November 3:15 AM receipt is insufficient.
   A failed/missing/stale receipt stops; never refresh dates or trigger another drill.
3. Bind the root-private installed `bootstrap/recovery-expected.json` to that
   successful setup. Compare exactly its three selected hashes, kept server-side.
   Preserve installed credentials/helpers/configuration and all OFF switches.
4. Explicitly approve reading only the existing B2/restic config, credential and
   password files on-server for this new purpose. Verify the pinned restic0.19.1
   binary hash and current private repository binding/prefix. Keep credentials
   out of command arguments, stdout, this Mac, Git and chat. No WAL-G/DB password,
   Apple signing-key or offline archive read is included in this three-file check.
5. Use the exact object snapshot from the original receipt, not `latest`. At most
   one reviewed read-only `cat config` to confirm repository identity and three
   bounded `dump` calls, no operator retry, listing, directory/general restore or
   remote write. Internal encrypted pack reads are not a fixed HTTP request count.

| Exact selected snapshot path | Exclusive RAM-only output |
| --- | --- |
| `/etc/barber-release/prepared-backend-runtime.override.json` | `runtime-override.json` |
| `/etc/barber-release/apple-cleanup-renewal/config.json` | `renewal-config.json` |
| `/etc/barber-release/recovery/customer-apple-encryption-v1` | `encryption-v1` |

6. Verify `/dev/shm` is tmpfs with sufficient capacity. Refuse any existing
   `/dev/shm/barber-apple-cleanup-verify-0743265` or unknown lease. Use unchanged
   `ops/auth/apple_cleanup_recovery.py:verify`, exact three-path hashes, actual
   installation epoch and bounded reader. Each file is at most 2 MiB. Check
   installed pin/configuration agreement and equality of the encryption key in
   recovered override and recovered same-key copy. Never export documents or
   key/token values or hashes. These files contain unrelated existing secrets too.
7. Delete only the operation's three proven regular/private RAM files, then its
   empty exact directory. Unknown files/symlinks or interrupted ownership require
   reconciliation; no recursive cleanup, pruning or clearing stale targets. Keep
   real installed recovery/staging files and all encrypted backups intact.
8. Save only aggregate original-receipt age, selected count, same-key/config
   match, RAM cleanup and restored-access results. Failure stays failure. A
   legitimate selected-file change between setup and backup needs exact binding
   reconciliation; never substitute a newly chosen hash or infer recoverability.

## B. Owner-held recovery custody — separate unresolved proof

The owner reported that the alternate saved identity opens the selected
`automated-backup-keys.tar.age` wrapper. That is recorded openability, not proof
that its contents contain the currently working B2 access credentials/restic
password/repository binding. The other historical archive is preserved too.
An age identity, B2 credentials, restic password and WAL-G DB recovery key serve
different purposes. None is interchangeable with the new Apple encryption key.

The on-server three-file check does not prove independent recovery after loss of
both server and Mac, or recovery of the Apple signing key/database/Storage.
Root should prepare a separate owner-mediated current-binding/custody proposal,
with exact destination and secret handling, before any archive/Passwords read,
decryption or credential test. Do not repeat identity trials or ask for secrets
in chat. Neither A nor B can be marked PASS from the other one's evidence.

No backup read, decryption, server connection, test, restore or credential lookup
was performed while preparing this plan. Existing successful rehearsal/setup
receipts remain historical evidence for their actual scope.
