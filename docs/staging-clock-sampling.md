# Staging clock sampling — October 8, 2026

The owner approved adjusting the existing Chrony sources on `srv1207055` to
meet the release verifier's five-minute reference-age limit. No production,
firewall, public-port, release-policy or deployment change was made.

At `2026-10-08T07:56:17.280Z`, the operator added **only `maxpoll 6`** to the
four existing pool directives in `/etc/chrony/chrony.conf`. This caps polling
at 64 seconds, Chrony's default minimum interval for public Internet servers.
Existing pool names, source counts and every other configuration byte remain
unchanged. Pool DNS may naturally resolve to different member servers.
Only `chrony.service` restarted. No manual clock-step command was used.

## Preserved evidence

- Original config SHA-256:
  `90ed2118d622b9a0488b46405b571575a3955a65cb56a9d3d8b8c1e196ba5d68`.
- Installed config SHA-256:
  `0c23a346add0ad2671baded289a63aa962d5d14443f1f5519367e721746ce586`.
- Root-private receipt directory:
  `/root/barber-staging-clock-tuning.BC8rS5/`, containing `chrony.conf.before`,
  `chrony.conf.after`, `installed.json` and `verification.json`.
- Reviewed frozen operator:
  `/root/barber-staging-observer-install.4Zc7Cf/tune-staging-clock-v2.mjs`,
  SHA-256 `d66bff4dff82ee140e91c0ecb064b821a32ba408a8fb83ee1c53cac7ae082043`.
- Source: `scripts/tune-staging-clock.mjs`. It refuses a different host, changed
  original config, unexpected ownership/mode or repeat application. It checks
  the candidate with `chronyd -p` before atomically replacing the live file.

The first candidate validation failed because Ubuntu's AppArmor profile does
not allow Chrony to read configuration from `/root`. It changed no live config.
Its backup at `/root/barber-staging-clock-tuning.6QqdQN/` remains. The corrected
operator validated a root-owned candidate under the existing permitted
`/etc/chrony/` path. No AppArmor permission was changed or disabled.

## Verification

- Config remains `root:root` 0644. Transformation testing proves that removing
  the four new options recovers the original bytes exactly; altered
  configurations and repeat application are rejected.
- Chrony synchronized normally. All eight resolved sources reported poll
  exponent 6. Its command sockets remained loopback-only at `127.0.0.1:323`
  and `[::1]:323`; no public NTP listener was added.
- The real verifier accepted its clock evidence at `07:58:22.642Z`, with
  error bound `0.0087899585` seconds, below the existing one-second threshold.
  This is timestamped evidence, not a promise of permanent synchronization.
- The installed manual observer passed the clock gate, downloaded the exact
  October 5 envelope (SHA-256
  `844d9c0641a2d711653b70ba111d4073fa25e41316dc53b080235678ffb6350e`),
  rejected it at `envelope-freshness`, and revoked its temporary GitHub token.
  Expected nonzero unit exit is retained as rejection evidence, not concealed
  as a successful release.
- No existing container ID/name/image changed: fingerprint
  `97496dffd167cc0e68ddd2ab9b1bd157682f1b98fa2b695f0a31c354fd9e7c08`.
- All 80 local verifier tests and operator syntax checks passed. PR #5's
  pre-adjustment head `c685e22` passed all five GitHub checks in run
  `37745292576`; later changes require their own CI result.

The clock blocker is resolved. A **fresh first-attempt release, explicit owner
approval of its evidence job, and a complete live service success check** remain
required. No main merge, image publication, frontend deployment, authoritative
replay ledger or broker mutation was approved by this clock adjustment.

## Recovery

To revert this sampling-only change, an administrator should first verify
that the live config still has the installed SHA above, review the root-private
`chrony.conf.before`, restore it as root:root 0644 using a same-directory atomic
replacement, validate syntax, and restart only Chrony. Reverify clock and
application health afterward. Restoring the old sampling interval can reintroduce
stale-reference rejection. Do not rerun the first-change script or overwrite a
configuration that another administrator has since changed.

References: [Chrony 4.5 polling options](https://chrony-project.org/doc/4.5/chrony.conf.html)
and [non-mutating configuration validation](https://chrony-project.org/doc/4.5/chronyd.html).
