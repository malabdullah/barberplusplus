# Staging backups to the owner's Mac

## Current status — 2026-09-28

**Transport implemented and tested; live application backup NOT ready.**
The new VPS Supabase stack is not deployed. No database, Storage volume,
production resource or legacy backup was read during these tests.

The staging/development safeguards require separate credentials, fail-closed
validation and recovery evidence. A successful file transfer is not a successful
database restoration and does not authorize a merge, migration or deployment.

## Provisioned resources

- Mac destination: `/Users/malabdullah/BarberBackups/staging`, mode 0700.
- Mac key directory: `/Users/malabdullah/.config/barber-staging-backup`, 0700.
- Dedicated private decryption identity: `identity.txt` in that key directory,
  mode 0600. Never print it, commit it, upload it to CI, or copy it to the VPS.
- `recipient.txt` in the same directory contains only the public recipient.
- VPS: `srv1207055` (`185.97.146.8`), public recipient at
  `/etc/barber-staging-backup/recipient.txt`, root-owned 0600 within 0700 config.
- Root-owned encrypted exports: `/var/backups/barber-staging/export`, 0700.
- Mac age 1.3.2 installed through Homebrew. VPS age package
  `1.1.1-1ubuntu0.24.04.3` installed from Ubuntu's configured security repository.
  No container/service restart was performed. No firewall change was needed.

The dedicated X25519 key is different from both SSH keys and all application
secrets. Only its public recipient was transferred to the staging VPS. Protect a
second copy of the private key before relying on backups. The owner chose a
password manager; its product and secure import are still pending. The recovery
copy has **not** been stored or verified yet.
Never overwrite/delete the current key during a later rotation: older archives
still require the identity they were encrypted for.

## Pulling a prepared encrypted export

```sh
npm run backup:staging-pull -- <backup-id>
```

Run on this Mac from the implementation checkout, with Node and `age` available.
The Mac must be awake and online, and its current public IP must be allowed by
the existing staging SSH firewall. There is no inbound backup server on the Mac.
The transfer tool never opens ports or relaxes host-key checking.

The receiver hardcodes only staging's host, administrative SSH identity and
export root. It accepts identifiers `staging-YYYYMMDDTHHMMSSZ-xxxxxxxx` or
`fixture-YYYYMMDDTHHMMSSZ-xxxxxxxx` (eight lowercase hexadecimal suffix digits).
The export directory contains root-owned mode-0600 `manifest.json` and
`payload.tar.age`. The directory and its export parents must be root-owned 0700,
not symlinks. Private key and local backup directories are also checked for
ownership, permissions and symlinks.

Manifest version 1 has exactly: `version`, `id`, `environment`, `sourceHost`,
`kind`, `file`, `sha256`, `bytes`, `createdAt`. Environment/host must identify
this staging VPS. Kind is `synthetic-probe` for fixture IDs, otherwise
`staging-backup`. Payload filename is fixed. The size limit is 50 GiB with a
2 GiB local free-space reserve. An actual larger backup needs a reviewed limit
change, not bypassing validation.

The transfer downloads into a new private `.partial-*` directory, requires SSH
success and exact ciphertext size/hash, then authenticates/decrypts the entire
archive to discarded output. It saves no plaintext during verification. Only
then does it publish a new destination and its `receipt.json`, with the receipt
written last. Existing destinations are never overwritten. Failed downloads
retain encrypted partial files for inspection; never accept a `.partial-*`
directory or directory existence alone as backup success.

Receipt status is `encrypted-transfer-verified`; `restoreVerified` stays false.
No automatic deletion, retention pruning, recurring schedule, or successful
freshness claim is made. A future deployment gate must require a fresh receipt
of kind **staging-backup**, tied to the actual capture/migration/release, plus
separate restoration evidence. Fixtures can never satisfy that gate.

## Validation evidence

`scripts/probe-staging-backup.sh` ran as root only on `srv1207055`. It made a
single known synthetic text file, tarred/encrypted it using the public recipient,
and removed only its own temporary plaintext file. It reads no application data.

Retained evidence identifier: `fixture-20260928T085615Z-e6a0a7eb`.
Encrypted archive size: 10,440 bytes. The corresponding private Mac directory
contains `payload.tar.age`, `manifest.json`, `receipt.json` and
`probe-restore.json`. The encrypted export also remains on the VPS.

- Authenticated VPS-to-Mac SSH transfer: passed.
- Ciphertext size/hash and age authentication: passed.
- Decrypting the tar in memory and recovering exactly `probe.txt`: passed.
- Recovered text matched the expected synthetic fixture exactly; no plaintext
  recovery file was saved on the Mac.
- Repeating the same pull refused to overwrite the existing backup: passed.
- Seventeen automated tests cover scoped paths/host/environment, strict manifest
  fields, size limits, private permissions, symlinks, wrong keys, tampering,
  positive receipt publication, duplicate protection, interrupted SSH/streams,
  overlong transfers and truncation. All passed locally. CI runs the same tests.

Run `npm run test:staging-backup` to repeat synthetic local crypto/transport tests.
These create and remove only their own temporary fixtures and keys.

## Still required before real backup acceptance

1. Owner stores and verifies a separate recovery copy of the decryption key.
2. After isolated Supabase provisioning, implement consistent capture of DB
   (including Auth/Vault needed for restoration), Storage objects and encrypted
   staging-only configuration. Retain immutable image/release/migration metadata.
   Do not mix production or retired legacy data into this stream.
3. Quiesce writes or use a verified snapshot strategy so DB references and
   Storage objects form a consistent recovery point. Never archive a live
   PostgreSQL data directory as a substitute for a supported database backup.
4. Encrypt before publishing on the VPS, then pull and verify on the Mac before
   a protected change proceeds. Capture failure must prevent export publication.
5. Restore into disposable isolated services and verify schema, synthetic users,
   RLS, Vault access and Storage objects. Do not overwrite running environments.
6. Agree recovery-point/retention requirements, then configure scheduling and
   stale/missed-transfer reporting. An offline Mac must fail the transfer gate.

Reference: [age encryption and key usage](https://github.com/FiloSottile/age).
