# Manual staging release observer

Scope approved October 8, 2026: prepare, test and install a **manual, read-only**
release checker using the existing restricted GitHub App. No deployment, timer,
scheduled polling, broker membership, DNS, firewall or production change.

Latest October 8 result: the separately approved [clock sampling adjustment](staging-clock-sampling.md)
resolved the stale-reference blocker. The installed service correctly rejects
the expired October 5 envelope. A separately approved fresh first-attempt run
`37748167638` then passed all individual evidence checks at 08:36 UTC, with its
temporary token revoked. See the [live receipt](staging-observer-image-publication.md).
This is not deployment authorization or replay-ledger verification. Historical
failure details below remain for audit.

## Trust boundary

The root-owned program runs as existing `barber-staging-deploy` UID 997/GID 985
on `srv1207055`. Its only remote writes mint/revoke its own short-lived read-only
GitHub installation token. It checks installation identity, exact read scopes
and the one selected repository before reading release evidence. The private
key is delivered by systemd's encrypted credential facility; tokens remain in
memory and the `gh` child environment, never command arguments or files. The
separate GHCR PAT is not delivered to this service: approved public packages
are read anonymously. No production credentials are accessed.

Reviewed local modules verify approval, CI, canonical envelope, artifact hash,
workflow source hashes, migrations, both immutable image manifests and all
three signatures. Root-controlled `selection.json` selects one run/commit and
pins the separately reviewed workflow hashes. Source downloaded from GitHub is
treated as data, never executed. Attempts other than 1 fail closed. Fresh trusted
Chrony time is required before parsing and again after signature verification.

Results always say `authorizing: false` and `deployed: false`. Success means
**individual evidence checks passed**, not accepted release or deployment
permission. This deliberately does not supply a fictitious empty replay ledger
to the aggregate authorization helper. The root release policy stays unchanged.

The private state directory holds fsynced, exclusive-create per-invocation JSONL
records (started, selected, finished). An exclusive `in-progress` directory
blocks concurrent or crash-interrupted invocations. Records are service-writable
diagnostic history, **not tamper-proof deployment replay evidence**. An abrupt
kill/power failure may leave only started/selected records and an installation
token that expires after at most one hour. Normal exits attempt revocation;
failure is explicit and cannot be reported as success. Review an interrupted
invocation before manually recovering its lock. Never automatically delete it
or silently rotate/truncate history. 1,000 state entries block further runs.

Systemd provides zero capabilities, no-new-privileges, read-only system paths,
private temporary files/devices, hidden home directories, clock/kernel
protection and resource limits. Docker/broker sockets and the private backend
root are inaccessible. No listener or install/enable target exists. Outbound
IP networking remains available for GitHub/GHCR and local Chrony queries; this
is not a host-level domain egress firewall. Root compromise is outside this
boundary; host-key credential encryption does not defend against host root.

## Installation and manual operation

1. Run `npm run check`, `npm run test:e2e`, observer negative tests and
   `sh -n ops/staging-vps/observer/install.sh`; record a separate code-review pass.
2. Transfer only the installer's ten allowlisted **public** source/config files
   into a new transfer directory. Freeze copies into a new
   `/root/barber-staging-observer-install.*` directory: root:root 0700 directory,
   root:root 0444 files, no links. Compare each SHA-256 with the reviewed Mac
   source before running the frozen `install.sh` with sudo. Never execute from
   the user-writable transfer directory.
3. The first-install script refuses existing destinations, unexpected accounts,
   changed Node/GH binaries or an existing unit. It copies the already verified
   Node 24.20.0 runtime to its own public root-owned tree without opening the
   backend directory. It verifies the systemd unit, reloads definitions and
   leaves the service **inactive/static**. No `enable`, timer or cron is created.
4. Verify installed hashes and effective unit restrictions before manually
   running `sudo systemctl start barber-staging-observer.service`. The initial
   selection is the **expired October 5** run `37280715144`: expect a nonzero
   exit and `observation-rejected` at `envelope-freshness`, not a fresh approval.
   Inspect only sanitized journal records and `/var/lib/barber-staging-observer/`.
5. Confirm token revocation, preserved UID/groups, no broker/Docker access and
   unchanged existing container IDs/images/health. Repeat the negative run to
   prove normal audit completion permits another manual observation, never a
   deployment. Do not change the signed envelope or pretend an old timestamp is
   current to obtain a passing result.

Changing the selected run does not approve that release. A fresh successful
live service observation requires a new first-attempt release and explicit
owner approval of its evidence job. Public routing and actual deployment remain
separate approvals. Do not merge this observer branch without exact-head owner
approval and the five required CI checks.

To stop the checker: `sudo systemctl stop barber-staging-observer.service`.
It does not restart or run at boot. Preserve code, encrypted credentials and
audit history; no destructive automatic uninstall is provided. A partial
installation must be inspected and repaired, not blindly rerun.

## Validation and limitations

October 8 validation: full `npm run check` passed again after the live-platform
correction (80 verifier tests, including 12 observer tests); installer shell syntax and `git diff --check`
passed. All five local Playwright journeys passed using the actual loopback
Supabase browser key supplied only via the test process environment. The first
run used the fallback test key and overlapped another build; it failed four
login journeys and is retained as a failed attempt, superseded by the correctly
configured isolated rerun. No database was reset.

A separate AI code-review pass (not independent human review) examined the
credential lifecycle, subprocess boundary, root-controlled inputs, unit and
first-install script. It added explicit non-authorizing flags on every token
result, secret-safe local failure phases, selected-run audit identifiers, a
partial-write loop for audit records and removal of inherited runtime injection
environment variables. No deploy/broker API is imported or called. The scoped
observer installation is already owner-approved; this is not approval to merge
the branch or deploy an application release.

## October 8 installed-state receipt

Installed on `srv1207055`, manual/static, not enabled or scheduled:

- Program/runtime: `/opt/barber-staging-observer/` (root-owned, non-writable
  by the service); selection: `/etc/barber-staging-observer/selection.json`.
- Unit: `/etc/systemd/system/barber-staging-observer.service`.
- Original frozen bundle: `/root/barber-staging-observer-install.4Zc7Cf/`.
  Corrected frozen files are `runner-systemd255.mjs` and
  `staging-observer-systemd255.mjs`; originals and the diagnostic intermediate
  `runner-metadata.mjs` are retained. The first-install script was not rerun.
- Installed runner SHA-256:
  `be4325c8b0292f26234affe0576e10d3a5ffccd9809b2c63e7d966ddd446c698`.
- Installed observer module SHA-256:
  `30b2b6012029871fc317c055f88d6d3bbd4d45e14061fd6104bf5a220b6c1159`.
- Installed unit SHA-256:
  `94f328d1b680271b35f0623b1ef784d3c16314b2ea7d223838e23b2dfa52c180`.

First runs safely failed before network access because the initial custody check
expected 0400 files. This systemd 255 host instead supplies root:root 0440 files
with an ACL granting read access only to UID 997, consistent with the
[systemd credential implementation](https://github.com/systemd/systemd/blob/v255/src/core/exec-credential.c#L150-L199).
The checker was corrected to require that observed owner/mode profile; no
credential permission was changed. A live metadata-only ACL probe confirmed
root and UID 997 read access, no group/other access. It also verified actual
kernel UID/GID, no-new-privileges and all five capability sets equal to zero.

Subsequent manual runs successfully validated the GitHub App installation and
single-repository read scopes, then **rejected at the clock gate**, and revoked
their temporary tokens. At 07:38 UTC Chrony was synchronized but its selected
reference sample was 23 minutes old, exceeding the verifier's existing
five-minute reference-age limit. Its default sampling interval can exceed that
limit. Clock configuration was not changed and the limit was not weakened.
At that point, approval for a staging-only sampling adjustment was requested;
the later approved change and successful expiry rejection are linked above.
At that point the service had not passed a fresh full release check. Its failed
unit state was intentional evidence of the closed gate, not a running/crashed
backend service. The later fresh observation linked above exited successfully
and left the unit inactive/static, with no scheduler or deployment capability.

Private 0600 per-run audit files survive service exits; normal locks were
removed after completed failures. A separately created empty test lock blocked
a new invocation at audit initialization, before any token request. Only that
probe's empty lock was removed; all audit records remain. An initial optional
ACL probe found `getfacl` absent; the successful probe read only POSIX ACL
metadata using the already installed Python, without installing packages.

All pre-existing running container IDs/names/images retained fingerprint
`97496dffd167cc0e68ddd2ab9b1bd157682f1b98fa2b695f0a31c354fd9e7c08`.
All eight private backend containers remained running, with all six existing
health checks healthy. Account memberships, broker capabilities, root release
policy, DNS/firewall and production were not changed. No frontend was deployed.

- New synthetic tests cover scope/repository substitution, token cleanup,
  secret-safe failures, selected-run validation, expiry before/after checking,
  unsigned images and altered artifact/migration evidence. These are not live
  cryptographic proofs. Existing verifier tests cover the actual validator
  boundaries and malformed transports.
- No application image, database migration, seed or function bundle changes.
  No local or remote database reset is needed for this infrastructure-only work.
  Frontend image tests are unchanged; this feature is validated as a host
  service, not an application-container release.
- Remaining Env3 work: authoritative crash-safe
  replay/authorization ledger, constrained backup/migration/deploy/recovery
  workers, fresh backup/restore evidence, release approval, frontend deployment,
  private ingress cutover and complete staging acceptance.

Sources: installed systemd 255 `systemd.exec(5)` credential documentation and
[GitHub installation-token documentation](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app).
