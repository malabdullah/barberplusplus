# Initial default-off setup and selected-file recovery

**Reviewed preparation only; not instructions to execute without the separate
owner approval.** The transformer and recovery verifier have no CLI, implicit
credential generation, network access or deployment action. All tests supply
deterministic fake signing/verification/entropy/readers. The original e32 app
rehearsal and operator074 supplement remain unchanged.

## Exact initial transformer / staging command plan

The future approved operator runner must validate root, hostname `srv1073968`,
the pinned public source hashes and the installed config paths from
`apple-cleanup-renewal.config.example.json`. It must not accept caller-chosen
URLs, subjects, repository locations, keys, paths or a test-mode override. Install
only the two new public preparation modules next to the reviewed renewal modules
at `/usr/local/lib/barber-release/`; root0755, no credential files in that location.

The proposed generation step uses only this tested call:

```python
bootstrap.stage(
    config, original_override_bytes, now_epoch,
    issue=apple_renewal.issue,
    validate=apple_renewal.validate,
    entropy=secrets.token_hex,
)
```

Those **real** dependencies must not be supplied before the later exact key/use
approval. Existing Live P8 is read on-server for P-256 signing and public-key
signature verification, for exactly the two pinned subjects. `token_hex(32)`
creates one independent encryption key. No secret is passed in command arguments,
printed, copied to the Mac, sent to a provider or reused from Test. The modules
do not import `secrets` or supply real dependencies automatically.

Before calling it, under the existing root-private backend release lock:

1. Verify the canonical existing override is a root-owned regular0600 file with
   no symlink, and the private parent is root0700. Confirm all four container image
   IDs/health via the reviewed `Host.inspect()`; record only safe runtime metadata.
2. Compare each supplied current override environment entry to the actual runtime
   and require the active Functions Compose config-hash to match its container.
   Reject any existing cleanup pair/encryption variable, even empty, or any true
   deletion flag. Do not treat missing/mismatched sources as permission to reset.
3. Verify APP_ENV/website/public API/current internal backend are the exact Live
   pins. Read/validate the approved existing key only after these no-change guards.
   Keep the root lock until the exact staging snapshot has been captured.

The transformer issues/validates both subjects before requesting any encryption
bytes. Wrong scope, lifetime, partial/unknown existing configuration or signature
failure blocks staging. It changes only the pair, independent key, fixed backend
binding and three explicit **false** switches; all other service/env/Compose
values and the input document remain unchanged.

It creates **only one new exclusive** directory:
`/etc/barber-release/apple-cleanup-renewal/bootstrap` (root0700), containing:

| File, all root0600 | Purpose |
| --- | --- |
| `original.override.json` | Exact prior override bytes, for recognized rollback |
| `staged.override.json` | Full candidate, with all deletion switches false |
| `encryption-v1` | The same new encryption bytes, without a trailing newline |
| `scope.json` | Creation time, config/before/after/key hashes and expiry metadata |

Private files are fsync/atomically written. A pre-existing/partial directory blocks
every retry **before** any new signing or entropy. Do not delete it or regenerate
material blindly after interruption. The transformer never replaces the active
override, restarts a container, installs/enables a unit or calls a provider.

## Proposed default-off installation boundary

The separately approved runner must reacquire the same lock, verify config/source
hashes and exact `beforeSha256`, then validate the candidate Compose model. No
unrelated operator changes may be overwritten. Install only the named public
helper/config/four units, create the private state directory, and copy the staged
key bytes to **one exclusive** root0600 recovery file:
`/etc/barber-release/recovery/customer-apple-encryption-v1` (root0700 parent).
Refuse an existing file; never replace an older encryption version.

The approved active change is exactly the staged default-off override, using the
reviewed atomic primitive. Recreate only Functions on the pinned image with
`up -d --no-deps --pull never functions`. Verify the new fields exactly, hash every
other runtime environment value against its prior value, and verify Auth/DB/Storage
IDs/start times unchanged. On recognized failure restore the exact original
override and Functions configuration; do not change Auth or erase data. An
uncertain/failed rollback stops for review, retaining private evidence.

Release the lock before invoking the renewal companion, which acquires that same
lock itself. `--check` verifies signatures without signing/restart/journal writes;
a fresh normal run records `HEALTHY_NOT_DUE` with no signing/restart. Target Linux
unit validation remains required before enabling only the two new timers. No
forced real rotation is needed just to exercise a path already tested with mocks.
Do not enable deletion or call an Apple/Resend endpoint as part of this setup.

Record the actual successful **installation** time (not staging time) and the
SHA-256 of exactly the following three installed files in a new root0600 private
`bootstrap/recovery-expected.json`. Hashes stay on-server; key bytes/hashes are not
printed in the public result. The records must bind this source and config; a
partial installation must not produce an installed/recoverable success record.

## Existing backup mechanism and exact selected-file check

Use the existing nightly03:15Kuwait B2/restic configuration capture, whose fixed
sources already include `/etc/barber-release`. Do not start/alter the full daily
database/Storage drill, modify backup schedules/retention or create a new provider,
bucket, prefix, key or repository. Wait for its next genuine successful cycle.
The pre-setup daily receipt cannot prove the new files recoverable.

Proposed read scope for this future check:

- Existing `/etc/barber-backup/config.json`, `/etc/barber-backup/b2.json`,
  `/etc/barber-backup/restic.password`, repository binding and the original
  `/etc/barber-release/backup-readiness.json`, only on-server. Do not read WAL-G
  encryption, PostgreSQL password/HBA, the offline age identity or customer rows.
- Verify the exact existing private B2 destination, `production/v1/objects-v1/`
  prefix, pinned restic0.19.1 executable SHA and the root-private repository binding.
  Reuse only the existing credential/password for read-only recovery; no new
  persistent access or changed credentials. Keep credential values in process
  environment/protected files, never arguments or logs.
- Apply the unchanged backup policy to the untouched original receipt/current
  database system metadata. Require B2 daily-v1, same system/repository, all
  successful restoration flags and original capture/verification within26h.
  Additionally require capture **after the actual successful setup**. Never
  refresh receipt dates, query `latest`, write readiness PASS or rebind a snapshot.
- Bind the exact64-hex `object_snapshot` from that receipt. One optional fixed
  `restic --no-cache --no-lock cat config` command can compare the remote repository
  ID with the existing private binding. Then at most three fixed `dump` commands,
  no operator retries, listing, directory dump, general restore or remote writes:

```text
<pinned-restic> --no-cache --no-lock dump <receipt-object-snapshot> <one-selected-path>
```

Repository/password file and scoped AWS B2 values are provided only through the
existing protected environment. Capture stdout privately as bytes, discard raw
stderr, impose command/output/time limits. Restic can read multiple encrypted
packs internally; **only the three selected plaintext files** are returned to the
verifier. The command count is not a promise of a fixed number/cost of HTTP reads.
No secrets or backup contents are transmitted to this Mac or chat.

### Only selected plaintext paths

| Exact snapshot source | Local RAM-only filename |
| --- | --- |
| `/etc/barber-release/prepared-backend-runtime.override.json` | `runtime-override.json` |
| `/etc/barber-release/apple-cleanup-renewal/config.json` | `renewal-config.json` |
| `/etc/barber-release/recovery/customer-apple-encryption-v1` | `encryption-v1` |

The active override contains existing unrelated credentials; this check must use
its bytes for hash equality only and inspect only the pinned environment/key
binding fields, never export or log the document. No Apple P8 is selected or
restored by this file check. Existing signing-key recovery is separate existing
backup custody, not proved by this three-file test.

The future runner must verify `/dev/shm` is actual tmpfs, root execution and ample
capacity. The exact exclusive target is
`/dev/shm/barber-apple-cleanup-verify-0743265` (root0700). Refuse any existing target,
symlink or stale operation; never clear it first. No container, ports, database,
Storage, worker or outbound integration is started. Record a private lease with
target identity/source/snapshot before invoking the reader.

Use the tested verifier call, with only the private three-path manifest:

```python
recovery.verify(original_receipt, private_expected_hashes,
                actual_installation_epoch, now_epoch, bounded_restic_reader)
```

Each selected file is limited to2MiB and compared to its exact approved setup hash.
Missing/mismatched files fail. Verify the pinned config and equality of the key
in the restored override and the same-key recovery copy. If a legitimate subsequent
release/renewal changed a selected file before backup, stop and reconcile the
precise source/hash binding; do not mark it missing or silently accept a different
credential. The public result contains only file count, same-key/pass booleans and
cleanup result, with no paths, snapshot values, token/key bytes or their hashes.

## Scoped cleanup, including failure/interruption

The verifier tracks only its three exclusive created files, requires regular
private files owned by the current root operation and refuses unknown contents.
In success or ordinary failure it unlinks only those files, then removes its now
empty exact directory. It does not use recursive deletion, globs, Docker cleanup,
repository retention or any production source deletion. It reports success only
after the plaintext target is absent.

If killed or an unknown file/symlink appears, stop automatic retries. Under the
same approved cleanup scope, reconcile the private lease/target identity, then
remove only the proven operation-owned regular files with the expected names and
hashes; preserve every unknown file and report the blocker. Never rmtree a target
because its name resembles this operation. Do not remove the real recovery key,
bootstrap artifacts, active configuration or encrypted backups. This failure is
not a reason to reopen production SSH without a valid current access scope.

Custody is still **unconfirmed**. These on-server/B2 checks do not prove the owner
can independently obtain the existing backup-decryption identity after losing the
Mac/VPS. Await the answer to either existing clarification; do not ask again or
claim recovery readiness before that separate human custody gate is resolved.

Technical reference for exact-snapshot file dumping:
[restic0.19.1 restoring/dump documentation](https://restic.readthedocs.io/en/stable/050_restore.html#printing-files-to-stdout).
