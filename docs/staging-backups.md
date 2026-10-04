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
second copy of the private key before relying on backups. On 2026-09-28, the
owner reported saving the key in Apple Passwords under
`Barber++ staging backup recovery` and confirmed that the entry appeared on
another trusted Apple device. The owner then reported PASS from the hidden-input
recovery test; its private receipt was verified at 09:23:08 UTC on 2026-09-28,
including the fixture checksum and synthetic-only scope. Storage/sync and the
key's Apple Passwords source are owner-confirmed; the receipt independently
records successful decryption with the supplied key. No private key value or
screenshot was collected.
Never overwrite/delete the current key during a later rotation: older archives
still require the identity they were encrypted for.

### Checking the Apple Passwords recovery copy

Run locally in an interactive terminal (never paste a key into a command or chat):

```sh
npm run backup:staging-test-recovery -- fixture-20260928T085615Z-e6a0a7eb
```

Copy the Password field from the saved Apple Passwords entry, paste it at the
hidden prompt, and press Return. Do not use `identity.txt` for this test: it must
exercise the saved recovery copy. The prompt disables echo; the key passes to
age through stdin, not command arguments, environment variables or a temporary
key file. No working identity is read or overwritten. Decrypted output is
discarded. Clear the clipboard afterward by copying harmless text.

The check first validates the private, size-limited synthetic fixture and its
checksum. A successful age authentication writes a new private
`recovery-key-check-<uuid>.json` beside that fixture. A wrong key, corrupted
archive or invalid metadata produces no success receipt. The evidence proves
that the supplied key decrypted the fixture; the owner identifies its source
as Apple Passwords. It does not prove DB/Storage restoration or future Apple
account recoverability. The owner's saved-copy test passed, with receipt
`recovery-key-check-1f5732ca-ffdb-4f9d-b12b-b6dcea8c183f.json` retained beside
fixture `fixture-20260928T085615Z-e6a0a7eb`. Automated helper tests use unrelated,
disposable keys.

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
- Five additional recovery-helper tests pass locally: fresh-key recovery without
  an identity file, wrong/malformed keys, tampering with an altered manifest,
  fixture/permission/size restrictions, and rejection of non-interactive input.
  These are not evidence that the owner's Apple Passwords copy was tested.

Run `npm run test:staging-backup` to repeat synthetic local crypto/transport tests.
These create and remove only their own temporary fixtures and keys.

## Still required before real backup acceptance

1. After isolated Supabase provisioning, implement consistent capture of DB
   (including Auth/Vault needed for restoration), Storage objects and encrypted
   staging-only configuration. Include the separate `db-config` named volume:
   `/etc/postgresql-custom/pgsodium_root.key` is required to decrypt Vault data.
   The Compose `VAULT_ENC_KEY` variable alone is not a backup of that root key.
   Never print the key, commit it, or save it as unencrypted recovery evidence.
   Retain immutable image/release/migration metadata.
   Do not mix production or retired legacy data into this stream.
2. Quiesce writes or use a verified snapshot strategy so DB references and
   Storage objects form a consistent recovery point. Never archive a live
   PostgreSQL data directory as a substitute for a supported database backup.
   The file Storage backend also needs extended attributes (content type, cache
   control and etag), ownership and permissions. Plain `docker cp` archives are
   insufficient: the local recovery test reproduced HTTP 500 after that copy.
   GNU tar with `--xattrs --xattrs-include=user.* --acls --numeric-owner` on both
   capture and restore preserved these attributes and passed API verification.
3. Encrypt before publishing on the VPS, then pull and verify on the Mac before
   a protected change proceeds. Capture failure must prevent export publication.
4. Restore into disposable isolated services and verify schema, synthetic users,
   RLS, Vault access and Storage objects. Do not overwrite running environments.
5. Agree recovery-point/retention requirements, then configure scheduling and
   stale/missed-transfer reporting. An offline Mac must fail the transfer gate.

Reference: [age encryption and key usage](https://github.com/FiloSottile/age).

Supabase documents the independent root-key volume in its
[Postgres 17 backup guidance](https://supabase.com/docs/guides/self-hosting/postgres-upgrade-17).
The local core rehearsal now exercises this recovery requirement using only
fresh disposable synthetic services. It is not a live VPS capture, off-host
receipt, owner-key recovery proof, retention policy or deployment authorization.

On October 4, the six-service Linux AMD64 local rehearsal passed encrypted
round-trip/tamper rejection, restore into new volumes, Auth login, Vault
decryption, cross-tenant RLS denial, private Storage content/type and anonymous
denial. It uses a temporary synthetic age identity, never the owner's real key.
Only the labeled probe containers, networks, synthetic volumes and temporary
identity directory were removed. The existing development database was retained.
