# Apple cleanup credential renewal — prepared, not installed

This separate root-only companion renews the **existing complete** native/web
cleanup pair. It does not create encryption keys, bootstrap credentials, enable
deletion, change Auth login, or contact Apple/Resend/Supabase APIs. Installation,
real signing-key use, initial credentials, recovery copies and activation need
the later exact production approval. No real credential was used during testing.

The website, Function, schema, original login renewal helper and held iOS binary
are unchanged. Managed hosted Test has no VPS/Compose/systemd installation target
for this operator-only code. Tests exercise the actual companion and Host adapter
with deterministic non-JWT placeholders and mocked signing/Docker responses,
including the full replace/verify path. They start no Docker or local website and
change no Test Auth/provider configuration. This is not a live install or new
cryptographic/provider proof.

## Scope and invariants

- Exact production subjects: `com.barberplusplus.customer` and
  `com.barberplusplus.authentication.prod.web`, Team `D49RFZQ6BT`.
- Existing approved P-256 key; the example identifies the observed public key ID,
  not permission to use it. The unchanged `apple_renewal.py` implementation signs
  and verifies each subject. Both subjects are checked; native must never use the
  web subject or a Test subject. No external token/exchange/revocation is made.
- Run only on `srv1073968`, as root, under the same existing backend release lock
  used by the release consumer and login renewal. No new lock path is created.
  Require a root-owned regular private lock; if existing permissions differ,
  stop for review rather than chmod it implicitly.
- Pin all four current image IDs; require healthy Functions/Auth/DB/Storage and
  an unchanged rendered Functions Compose hash. Use the canonical shared runtime
  override. A missing current pair/key/binding fails closed, not bootstrap mode.
- Only `CUSTOMER_APPLE_REVOCATION_CLIENTS` changes. Preserve encryption key/version,
  all feature flags, login credentials, mail/service/cron keys, API bindings and
  every unrelated Compose value. Renew both client secrets together when the
  earlier expiry is within 30 days. Their lifetime is at most 180 days.
- Recreate only Functions with `--no-deps --pull never`. Verify its same pinned
  image, exact pair and hash of every other environment value, including the
  encryption key. Auth/DB/Storage container IDs/start times must remain unchanged.
  Functions may briefly be unavailable during renewal; accepted deletion work
  remains durable in the database for normal lease/backoff recovery.

## Reviewed files and proposed installation paths

| Source | Proposed destination | Mode |
| --- | --- | --- |
| `apple_cleanup_renewal.py` | `/usr/local/lib/barber-release/apple_cleanup_renewal.py` | root 0755 |
| Unchanged `apple_renewal.py` dependency | Existing `/usr/local/lib/barber-release/apple_renewal.py` | verify reviewed hash; do not replace implicitly |
| `barber-apple-cleanup-renewal.service` / `.timer` | `/etc/systemd/system/` | root 0644 |
| `barber-apple-cleanup-monitor.service` / `.timer` | `/etc/systemd/system/` | root 0644 |
| `apple-cleanup-renewal.config.example.json` | `/etc/barber-release/apple-cleanup-renewal/config.json` | root 0600 |
| Private state directory | `/etc/barber-release/apple-cleanup-renewal/state` | root 0700 |

All parent private directories are root 0700. Existing signing key remains at
`/etc/barber-release/apple-renewal/signing-key.p8`; the companion reads it only
after the future approved installation. The active shared override remains
`/etc/barber-release/prepared-backend-runtime.override.json` (root 0600). Its paths
must be verified during setup before installing; the helper refuses alternatives
rather than discovering or broadening targets. `config.json` contains public
pins/paths only, not JWTs/encryption material.

On the real target, separately run `systemd-analyze verify` on these four units
before enabling anything. It has not been run on this Mac. Keep units disabled
until initial config, runtime, recovery and default-off checks pass. Future
approval must cover installing these exact public files, creating only the named
private directory/config/state files, daemon-reload and enabling/starting only
these two new timers. Existing login/backup/release timers remain unchanged.

## Atomic update and rollback

1. Validate both existing JWT signatures/subjects and current runtime before any
   replacement. A fresh pair performs no signing/restart. Expired old credentials
   can renew after downtime if their signatures/scope are still valid.
2. Sign/validate both replacements before writing a candidate. If either fails,
   no partial pair is installed. Candidate files are 0600, written with fsync and
   atomic rename using the existing reviewed file primitives.
3. Validate the candidate Compose model, retain a root-private exact prior
   override, then fsync `PREPARED` state binding before/after hashes, config hash
   and safe runtime metadata. The journal contains no JWT/encryption values.
4. Atomically replace the active override, persist `CONFIGURED`, recreate only
   Functions, verify the invariants, then persist `RENEWED` within the same
   recovery boundary. If completion persistence fails, restore the exact prior
   file/runtime rather than reporting success.
5. A failed update restores only the recognized backup and verifies the original
   runtime invariants. An interrupted `PREPARED`/`CONFIGURED` state restores that
   same backup, records `ROLLED_BACK` and exits failed; the normal hourly retry can
   renew later. A changed config identity, unknown phase, unsafe backup path or
   unrelated override drift requires operator review and is never overwritten.

Backups/candidate files contain secrets and stay root-private within the existing
encrypted configuration-backup tree. Retain prior files for recovery; no automatic
pruning is added. A failed rollback remains an operator incident; never erase the
journal to force a green status. A provider failure does not justify rotating the
encryption key or deleting accepted cleanup work.

## Expiry monitoring

Renewal checks daily at 01:20 UTC (**04:20 Kuwait**), with up to five minutes
jitter and missed-run catch-up. Failed renewal retries hourly. This follows the
existing login-renewal schedule and shares its serialization lock.

The independent monitor runs hourly at minute 40. `--check` does not issue or
replace credentials, restart services, repair interrupted state, or write a
journal. It still performs local signature verification using the approved key
and reads the current runtime; it is not the earlier key-stat-only probe.
It opens the existing lock read-only to work with its read-only systemd sandbox.

Output contains status, checked time, pinned client IDs, expiry/renew-after times,
seconds remaining and severity only. More than 30 days is `OK`; within 30 days is
`WARNING`; 7 days or less/expired is `CRITICAL`. Critical monitoring exits 2;
invalid scope/configuration/recovery/health exits 1 with a generic error type.
Systemd records failed service status and safe JSON. No outgoing alert/email is
configured or claimed. An operator must observe failed units and the expiry
report; an automated external alert destination would be a separate feature.

After installation approval, check only these units and the private metadata
journal. Do not print Docker environments, candidate/backup overrides or key files
into logs/chat. Manual renewed-credential verification does not call a provider.

## Recovery custody and activation gates

The companion cannot reconstruct the independent version1 encryption key and
deliberately never rotates it. A restoration needs the **same** key for stored
envelopes/tasks plus valid credentials and the reviewed signing-key dependency.

Proposed custody is the existing root-private configuration backup tree and its
already encrypted off-host B2 configuration archive, separate from the database
archive, with the owner's existing offline backup-decryption custody. A separate
root0600 recovery copy is proposed at
`/etc/barber-release/recovery/customer-apple-encryption-v1`; it must contain only
the same already approved key, not a newly generated replacement. No copy exists
or has been created by this preparation. Confirm the owner can recover the
existing backup decryption identity without this Mac/VPS; do not ask them to paste
it or export it to chat. If that custody is unavailable, leave activation blocked.

The final setup packet must authorize the exact initial pair/key/copy creation,
prove only those protected files are included in a subsequent encrypted off-host
configuration capture, and verify restoration of the selected files inside a
private isolated recovery target without exporting key bytes. The pre-setup daily
receipt does not prove newly installed files are recoverable. No backup download,
decryption, new recovery target or credential/backup change is authorized here.

Before stopping renewal, first stop **new deletion requests** if necessary, keep
valid credentials/encryption/cleanup capability for accepted work, and reconcile
pending tasks. Do not disable the only maintenance path for pending Apple tasks,
restore old encrypted data over current writes, revoke the signing key, remove
envelopes or downgrade the new deletion worker as a routine rollback.

## Verification performed

`python3 -B ops/auth/apple_cleanup_renewal_test.py` and its Node CI wrapper exercise
31 cases with mocked signing/commands and no actual private key or entropy use.
Coverage includes earliest expiry, due/critical boundaries, namespace/client
denials, no-op and read-only checks, encryption/login/flags preservation, both
signatures before replacement, model drift, health/activation failure, interruption,
unknown changes, unsafe files, completion-write failure, the actual Host adapter
and full core-to-adapter update path. Existing application/SQL/Function/runtime
evidence remains unchanged; no new cryptographic/real Linux install proof is
claimed. A later production setup requires the separate owner approval.
