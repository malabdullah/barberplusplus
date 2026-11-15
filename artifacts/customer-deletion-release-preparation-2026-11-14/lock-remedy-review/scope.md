# Conditional lock inspection/remedy and default-off resumption

**Proposal only; independent review and fresh owner approval required.** No new
server connection, lock metadata collection, chmod or setup continuation has
occurred since the guard stop. Do not ask the owner before the iOS chat reviews
this packet; that chat will present any follow-up approval once.

## Observed and unknown

The previous attempt transferred only nine public reviewed files, then stopped at
the existing lock guard. No P8/Compose private environment was read, no credentials
generated, no helper/units installed/enabled and no runtime/SQL/source changes.
The original firewall367995/five unchanged rules is restored, exact temporary
rule removed, no SSH sessions remain; activation request to cleanup receipt398s.

Exact submitted predicate:

```python
info.st_uid == 0 and stat.S_ISREG(info.st_mode) and not info.st_mode & 0o077
```

It followed an existing-file `O_RDWR|O_NOFOLLOW` open and successful fstat. Python
AST/truth-table review confirms a correct octal group/other-bit mask, regular-file
check and UID0 comparison; there is no decimal600/full-mode-equality or `not`
precedence error. This matches the original companion semantics. The earlier
public-transfer wrapper SyntaxError was separate and corrected before this guard.

**Actual UID/GID/mode/type/parent metadata was not exported.** Do not guess0644,
root ownership, regular-file status or a safe parent. A final symlink was not
followed by the successful no-follow open; ancestor safety was not established.

## Fresh bounded access

Only DB72.61.164.64/resource1073968/srv1073968. One fresh ipify globally routable
IPv4 lookup, exactly that /32 TCP22, existing SSH identity/strict host key,
verified dedicated copy preserving every actual original rule, <=1h operational
window/no automatic TTL claim. Stop new work45min, reserve15min restoration.
Changed IP, host key, inaccessible restore controls or unexpected rules stop.
Always close SSH/restore original profile/rules/remove exact added rule after
success or failure. No frontend access or management ports. No reuse of closed
access without the new approval.

## One-file exception, streamed fixed helper

The source-hashed `lock_permission.py` is proposed for one stdin execution as
`PYTHONDONTWRITEBYTECODE=1 python3 -`, with no arguments, root only on exact host.
It is not installed as a service/helper. No paths are supplied by callers.

Only target `/var/lib/barber-release-backend/backend.lock` and its immediate
canonical parent `/var/lib/barber-release-backend` receive metadata checks. The
helper returns safe UID/GID/numeric mode/type/link-count/size/device/inode only;
it never reads existing file contents. Parent must resolve canonically, be an
actual root-owned0700 directory, not a symlink. Open the parent no-follow, verify
same identity, then lstat the fixed filename. No file is created.

The only accepted file is root-owned, regular, single-link, empty and mode:

- **0600:** no-op; never call fchmod.
- **0640 or0644:** open the existing file no-follow/nonblocking, verify the same
  inode, acquire the existing nonblocking exclusive flock, revalidate named/fd/
  parent metadata, then **fchmod that same fd to0600 only**. Verify unchanged
  device/inode/ownership/group/empty size/link count and actual mode0600, with
  unchanged parent identity/permissions. No truncate, rename, replacement,
  chown, parent chmod, new lock, service restart, credential or content access.
- **Anything else, busy, missing, race/drift or unsafe:** stop unchanged and
  restore access. No guessed repair or retry with a different mode/owner/path.

Public source consumers are the root release/login-renewal workflows; tracked
service units have `User=root`. This is source evidence, not an assertion that
unknown actual unit metadata was captured. Effective access preservation follows
the **freshly verified actual root0700 parent/root-file invariants**: ordinary
non-root actors could not traverse this parent beforehand, while the root actors
retain access. Existing consumers use the same inode/flock; all contents/owners
and original source guards remain unchanged. The observed host must satisfy
these conditions before any permission change is justified.

## Conditional resumption of the original setup

Only after `ALREADY_SECURE_NOOP` or `TIGHTENED_SAME_INODE`, and only under the same
fresh bounded approval/window, rerun every original preflight guard. The original
source guard is not weakened. Reuse the existing public payload directory
`/etc/barber-release/apple-cleanup-setup-public-146ac50` only if root0700,
exactly the nine recorded regular root0600 public files and their original
reviewed hashes match. Do not overwrite, retransfer into unknown content or reset
private state. All newly proposed private/config/unit/recovery paths must still
be absent; stale/partial state requires review rather than regeneration.

Then resume only original default-off packet51031d3a/sourcee32/operator074/
bootstrap146: exact on-server P8 verification/native+web issuance, one independent
key/same-key recovery copy, named helpers/config/four units, atomic default-off
environment/Functions-only restart and recognized rollback, two persistent
maintenance timers. All three deletion switches stay false. No provider/customer/
message/SQL/Function-source/frontend/dev/main/backup/activation/publication/upload/
submission scope is added. Existing login, encryption source policy and archive
preservation remain unchanged. No independent recovery-readiness claim is made.

## Rollback and hold conditions

The permission operation is a one-file security tightening. Do **not** automatically
restore broader0640/0644 mode after a later setup failure. Leave verified0600 on
the same inode; root consumers retain their access. Any uncertain chmod/result or
postcondition stops for review; do not chown, replace the inode or issue another
chmod. Original setup rollback may restore only recognized override/runtime and
new timer state, never the lock inode, credentials of another operation or data.
Restore firewall access regardless of any unresolved setup condition. Unknown
metadata/partial private state, exhausted window or failed rollback is a hold.

## Focused verification

Fourteen new synthetic-only tests cover0640/0644 same-inode tightening,0600 no-op,
other modes/owner/parent/nonempty data, symlink/hardlink/type/FIFO, busy flock,
identity/locked-metadata races, fchmod failure and fixed root-host/metadata-only
entry point. Five literal-predicate truth-table/AST checks are also recorded.
No server/key/real secret/Docker/provider or deployment was used for these tests.
Core e32/operator074/bootstrap146 sources and prior evidence remain unchanged.
The tests do not establish the actual host's lock metadata or authorize repair.
