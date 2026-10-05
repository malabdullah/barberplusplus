# Read-only staging broker foundation

This is **not a deployer, release verifier or live readiness check**. It is the
small first installation of the approved server-side architecture. It accepts
one small JSON request per local Unix-socket connection and authenticates Linux
peer credentials. Only `status.inspect` succeeds; all mutating operations are
disabled in code. There is no subprocess execution, credential access, source
checkout, HTTP listener, GitHub runner, polling schedule or configurable enable
flag. `automationReady` and `liveStackVerified` always remain false.

The socket is root-owned `0660 root:barber-staging-release`. The service runs as
the separate unprivileged `barber-staging-broker` user with no capabilities and
a read-only filesystem. The `barber-staging-deploy` identity is reserved for a
future observation-only release verifier. Neither account has an interactive
shell, sudo, Docker membership or socket-group membership. Root operators can
inspect the status; adding a verifier to the socket group requires later review.

## Validate and install

Run `python3 -I -B ops/staging-vps/broker/test_broker.py` and
`sh -n ops/staging-vps/broker/install.sh`. Review the code and systemd isolation
before transferring these public files to a new private staging-host temporary
directory. Freeze the six installer/code/unit files into a **new root-owned**
`/root/barber-staging-broker-install.*` directory (mode `0700`, files `0444`).
Compare SHA-256 values on that frozen copy against the reviewed local files,
then run `sudo sh <frozen-directory>/install.sh`. Never execute from a
user-writable transfer directory. Keep the frozen copy for audit.
The installer accepts no arguments and only runs on `srv1207055` / x86_64. It
refuses existing accounts, groups, symlinked/unprotected sources, existing
systemd definitions/drop-ins or installation paths. Before activation it checks
effective systemd isolation and exact installed unit bytes;
partial failure requires inspection rather than a blind retry. It does not
modify existing Dokploy/application services or provider firewall rules.

Verify the socket ownership/mode, root-owned non-writable program and units,
non-root service identity, actual kernel peer checks, denied nonmember access,
malformed/oversized/duplicate requests and disabled mutating operations. Confirm
existing services remain healthy. No secret belongs in a request or output.
`validate_live.py` is the repeatable read-only administrator probe: stream the
reviewed file to `sudo -n python3 -I -B -` over the staging-only SSH connection.
Its child processes temporarily drop privileges to test socket denial and kernel
peer rejection; it does not change persistent memberships. It also checks the
running process's UID, zero capability sets, no-new-privileges and separate
network namespace. It never inspects application data or credentials.

On systemd, `show --all` is required: without it, empty safety properties such
as `CapabilityBoundingSet` are omitted. A regression test covers this case.
If installation has stopped after files/accounts were created, do not rerun
the first-install script. Inspect the partial state, freeze/hash-check any
corrected checker, validate effective settings and exact unit bytes, then
separately authorize resuming the socket activation. Do not bypass the check.

To disable this new foundation, an administrator can run
`systemctl disable --now barber-staging-broker.socket` followed by
`systemctl stop barber-staging-broker.service`. The accounts and files remain
recoverable for inspection; no broad deletion or automatic uninstall is used.

## Still required

The separately reviewed signed release-envelope verifier, immutable artifact
validation, protected-main CI/owner-approval checks, freshness/replay ledger,
constrained real backup/migration/rollback operations, live bootstrap and recovery,
runtime security acceptance and per-release approval remain prerequisites.
Installing this foundation must not enable a GitHub workflow or mark Env 3/4
complete. See the Env 4 server-side deployment protocol proposal.
