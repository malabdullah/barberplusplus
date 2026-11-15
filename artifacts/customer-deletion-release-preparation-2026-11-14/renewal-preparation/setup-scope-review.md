# Default-off credential/renewal setup — technical review packet

Status: **prepared for independent review; no Live permission question yet**.
Operator source is frozen at `07432656c506cd27af4a7328bfc3d51eac9a1e3b`.
The supplement manifest binds all nine new public files and 31 synthetic tests.
Application/Function/SQL/runtime-lock source remains exactly `e32cfb9`; the original
48-suite rehearsal is retained for those unchanged paths, not claimed to have
executed this new operator companion.

## Proposed bounded operation after approval

Target DB VPS72.61.164.64 only. A new exact access request will be needed after
review; the completed read-only session/firewall approval is closed. Use one
then-current public IPv4/32 on TCP22, existing inspection key and strict host key,
dedicated verified firewall copy, one-hour operational limit, immediate original
profile restoration and exact added-rule removal. No frontend access belongs to
this setup. Do not reuse access indefinitely or widen it after an IP change.

The proposed credential use is **new-purpose use** of the existing Live P8 for
both token cleanup subjects. The iOS agent separately reports visible Apple portal
group/capability matches; include that source evidence in the final request. It
does not establish on-server P8 correspondence or provider success. Approval must
explicitly cover reading the key on-server to derive its public key, verify the
existing/replacement signatures and issue the two client-secret JWTs. `--check`
is non-mutating/no-signing but **does read the P8 for local verification**; it is
not the completed metadata-only/stat-only probe. No P8, JWT or encryption bytes
may leave the VPS, appear in command arguments/logs, enter Git or enter Test.

### Proposed paths and identities

| Item | Exact proposed destination/scope |
| --- | --- |
| Existing P8 | `/etc/barber-release/apple-renewal/signing-key.p8`, no replacement/revocation |
| Team/key metadata | TeamD49RFZQ6BT, observed keyG2ANJ69763; verify match before use |
| Native cleanup client | `com.barberplusplus.customer` |
| Web cleanup client | `com.barberplusplus.authentication.prod.web` |
| Shared active override | `/etc/barber-release/prepared-backend-runtime.override.json`, preserve all current settings |
| New public companion | `/usr/local/lib/barber-release/apple_cleanup_renewal.py`, root0755 |
| Unchanged dependency | Existing `/usr/local/lib/barber-release/apple_renewal.py`; verify original reviewed hash |
| Config/state | `/etc/barber-release/apple-cleanup-renewal/config.json` and `/state/`, directories0700/files0600 |
| Existing shared lock | `/var/lib/barber-release-backend/backend.lock`; verify safe permissions, no implicit alteration |
| Four new units | Exact tracked `barber-apple-cleanup-{renewal,monitor}.{service,timer}` under `/etc/systemd/system/`, root0644 |
| Separate same-key recovery copy | `/etc/barber-release/recovery/customer-apple-encryption-v1`, root0600, directory0700 |

Initial staging will need a separately reviewed bounded bootstrap procedure:
verify the current canonical override/key paths and absence of any existing
cleanup pair/key before creating anything; issue/validate the exact two subjects,
create **one** independent random256-bit encryption key, stage the three values
and matching internal backend binding together with all three deletion switches
false. Preserve Auth/login/Resend/service/cron/session values exactly. Retain a
private exact prior override and verify a diff limited to the reviewed new keys.
Do not call the renewal helper on an absent pair: it deliberately refuses to
bootstrap. Do not overwrite/rotate an existing pair/key if state differs from the
observed absent baseline; stop for review.

No bootstrap script has yet been executed or real material created. The final
execution packet must freeze/test the exact bootstrap transformer/commands, not
substitute an unreviewed ad hoc shell at installation. This remains an explicit
gate before asking for setup approval.

The setup then installs the public companion/config/units, runs target
`systemd-analyze verify`, safely recreates only Functions under the release lock
for the default-off environment, verifies pinned health/config and unaffected
Auth/DB/Storage, and runs `--check` (local signature validation) plus a fresh-pair
no-op. Enable/start only the two new timers. Any restart or failure/restore step
must be in the approved setup scope. No real provider request or message is part
of that operation. The existing login renewal/timer stays byte-identical.

### Recovery destination and custodianship

The exact proposed independent key copy above is separate from the database.
Off-host destination is the **existing encrypted B2 configuration archive**, not
a new bucket/provider/account. Custodian is the owner using the existing offline
backup-decryption identity. Do not read/export that identity to this Mac/chat or
replace it. Before activation, confirm that recovery is possible independently
of this Mac and VPS; inability to demonstrate custody blocks activation.

After setup, require a subsequent genuine configuration backup that contains the
new pair/config/state and same-key recovery copy. The pre-setup14November receipt
cannot attest these new files. The final recovery check scope must name the
fresh receipt/archive binding and isolated private restore target, restore only
the selected configuration material on-server, compare bindings/hash equality
without exporting key bytes, and remove only its explicitly scoped temporary
target. Existing data/archive retention is untouched. Preparing this document
does not authorize a backup download, decryption, private recovery-key access,
new restore container or schedule change. No Docker is being started under the
old rehearsal approval.

## Atomic renewal, monitoring and rollback

The tested companion preserves the encryption key/version and replaces only the
native/web credential JSON together. It uses the shared release lock, exact
Compose/image guards, root-private fsync/rename, durable before/after hashes and
private backup, same-image Functions-only restart and post-checks. Unhealthy or
interrupted replacements restore the recognized prior override/runtime; unknown
drift fails closed. Failed rollback retains unresolved state for operator review.
Do not erase journals, pending tasks/envelopes or encryption to manufacture a pass.

Renew daily04:20Kuwait (+up to5min jitter), retry failures hourly. Independent
hourly:40 read-only checking reports warning<=30days and critical<=7days/expired;
critical exits2 and failed service status is operator-visible. It sends no
outbound alarm/email. The final operational handover must identify the person
observing systemd failures; an automatic external alert channel is not implemented
or implicitly authorized. Root-only metadata outputs contain no credential values.

During installation/default-off rollback, restore the exact recognized prior
override and newly installed public-unit state only, preserving unrelated files.
After deletion is active, stop new requests first and retain cleanup, valid pair,
encryption and renewal for accepted work. Do not downgrade the worker or remove
credentials while accepted Apple tasks require them. Data erasure cannot be
undone by restoring a setting or reversing SQL.

## Later deployment and acceptance gates remain separate

No production migration/Function/frontend deployment, feature activation, policy
publication, real provider/message, customer/reviewer lookup or provisioning is
authorized here. The eventual source-specific release must preserve102 applied
hashes, apply only9 reviewed pending migrations, pass required CI, bind immutable
website/backend artifacts and rollback, refresh backup/runtime/actual-schema
evidence, verify fixed production identity and correct cron names, publish only
accepted copy, and verify the actual deployed commit/image.

The proposed reviewer inbox remains `support@barberplusplus.com`; later scope must
verify collision/eligibility and owner delivery/control before creating a separate
customer account. No mailbox credentials can be App Review credentials. Live
Apple-provider validation requires a precise suitable grant/account scope, not
an assumption that the regular owner account is disposable. Native upload,
submission, App Privacy publication and public release remain separate approvals.

This packet is intentionally **not ready to execute** until bootstrap and exact
post-setup recovery procedure/custody proof are concretely bound and independently
reviewed. Its completed engineering closes the durable renewal code gap, not the
remaining Live setup/activation gates.
