# Realtime staging security candidate

Local candidate only. Nothing here changes deployment pins, deploys a service,
accepts vulnerabilities or approves production. Owner approval covers this
restricted staging profile, not a blanket scanner waiver.

## Preserved source and reproducible inputs

The base is official `supabase/realtime:v2.140.7`, selected by AMD64 manifest
`sha256:482868126f20243547d2d2cb03f78d78eeb318435c48198a1a43f8c491433864`.
Reviewed [source commit](https://github.com/supabase/realtime/tree/e0d1f657161f7f01e9b4be156627d974fdc6918d)
contains the Dockerfile, `run.sh`, and `rel/env.sh.eex` used for dependency review.
All existing `/app` file bytes are SHA-256 checked before/after hardening. No
Erlang/Elixir bytecode, protocol, booking, notification or agent feature is
rewritten. Application ownership/modes change to root-owned and non-writable.

Debian packages resolve only from the fixed `20261004T000000Z` snapshots.
Archive signatures and package checksums remain required. HTTP transport is used
because the base image could not validate the snapshot HTTPS chain; this does
not disable archive signature verification. `Check-Valid-Until: no` is limited
to these immutable historical snapshots. All three InRelease SHA-256 hashes in
`snapshot.sha256` were obtained over verified HTTPS and are checked before any
package upgrade, preventing replay of different signed historical metadata.
Update errors fail the build. Package
inventories and the exact optional-removal plan are retained inside the image
at `/usr/local/share/barber-realtime-evidence/`. Rebuilding reproduces source and
package inputs, not necessarily an identical OCI digest (build timestamps and
attestations vary). Each rebuilt image must be inspected, probed and scanned.

Only `awscli`, `sudo`, and their auto-installed dependency closure are purged:
38 packages, including Python, in the verified build. Before removal, every
planned package is checked against Debian Essential/Protected flags. Required
Erlang libraries, curl, Debian Essential packages and the pinned pgdelta binary
remain. SUID/SGID bits are removed; application contents remain unchanged.

## Mandatory runtime profile

Use `runtime-profile.yml` as a reference during explicit integration; it is not
automatically applied anywhere. The guarded startup requires UID/GID 65534,
zero effective/permitted/bounding capabilities, no-new-privileges and a read-only
root filesystem. All app code is root-owned. Only bounded `/tmp` and
`/app/.pgdelta-cache` tmpfs mounts are writable; the latter must permit execution
because the unchanged upstream pgdelta wrapper extracts its bundled executable
there. No host mounts, published Realtime ports, devices, Docker socket or host
namespaces. The resource limits are initial-test limits, not capacity acceptance.

No AWS credentials/settings are permitted. The guard rejects nonempty `AWS_*`,
cluster-certificate settings, ECS metadata URIs and S3 crash-export settings;
`ENABLE_ERL_CRASH_DUMP` must be absent or `false`. Therefore upstream AWS Secrets
Manager certificate generation, Fargate metadata discovery and crash-to-S3
upload cannot be enabled accidentally after removing their dependencies.
Normal database migrations, self-hosted synthetic tenant seeding and server
startup remain upstream behavior. Local Erlang crash files may still use the
bounded private `/tmp`; no dump is uploaded.

Supply a fresh environment-specific `RELEASE_COOKIE`, alongside dedicated
Realtime JWT/database/application secrets. Upstream Erlang distribution remains
unchanged; the packaged release cookie is not a staging credential. Do not expose
EPMD/distribution ports, and do not reuse a production cookie.
Use 32 random bytes encoded as base64url (43 characters), not 64-character hex:
libcluster_postgres uses the cookie in a PostgreSQL channel limited to 63 bytes.

Curl, if used for healthchecks, must be a fresh process with `-q` as its first
option, `--noproxy '*'`, explicit `--proto '=http'`, a fixed loopback HTTP URL
and a timeout. No redirects, external targets, proxy use, STARTTLS, SFTP/SCP,
Negotiate or Digest authentication. Integration owns the exact route/token.

## Local checks and evidence

From the repository root (Docker Desktop/local Unix socket only):

```sh
node ops/staging-vps/realtime-security/build-local.mjs
node ops/staging-vps/realtime-security/probe-local.mjs sha256:EXACT_LOCAL_ID
node ops/staging-vps/realtime-security/scan-local.mjs sha256:EXACT_LOCAL_ID /absolute/path/to/verified/trivy
```

The helper binds every Docker action to one verified local Unix socket. Probes
use disposable no-network/no-port containers and synthetic rejected values.
Positive profile, original app checksums, native linking, BEAM version and
`pgdelta --help` passed. Negative tests reject AWS settings, root, missing
no-new-privileges, writable rootfs and extra capabilities without printing the
synthetic value. No database/application boot claim follows from these checks.

On October 4, local reference
`sha256:2ea7fb6d3211f8e627985e473329dc5bb1abbbdc810d02784847d0a82bbd092c`
selected AMD64 platform ID
`sha256:78f25384ba6173d08f4dd7969989f5115d986cf4e8923f7906bf4fa00bfd1902`.
Fresh scan DB updated `2026-10-04T08:52:32.606987838Z`: **52 High, 0 Critical**
over 119 Debian packages, 12 distinct High CVEs. Same-DB baseline was 137 High /
3 Critical; OS patches alone gave 78 High / 0 Critical. Raw findings remain,
with no ignore file, severity manipulation or exploitability-based count reduction.

Raw scan: `/private/tmp/barber-realtime-scan.WGGGjN/raw.json`; SHA-256
`f27af897b0a0326272dc0be0ddf6842899027c77d4d8484cdebf3ecd0a3d5f4b`.
Profile/native evidence: `/private/tmp/barber-realtime-profile-probe.GR2OUj/evidence.txt`.
Build identity: `/private/tmp/barber-realtime-hardened.FO6qSB/metadata.json`.
These local temporary artifacts are not durable remote attestations.

Full release eval on this ARM Mac initially failed with `prim_tty:isatty` / `nouser`
for both the unchanged upstream image and this candidate. The
[upstream Erlang issue](https://github.com/erlang/otp/issues/10355#issuecomment-3510018425)
identifies unsupported AMD64 user-space emulation and JIT W^X mappings. The local
probe uses `+JMsingle true` only when Docker reports an ARM host; it does not alter
the image or staging runtime profile. This relaxes JIT mapping behavior solely
for synthetic local diagnostics. Native AMD64 acceptance remains mandatory.
The final local probe also passed full release `eval` with synthetic secrets,
`APP_NAME=realtime`, a 43-character cookie and the unchanged restricted profile.
Release eval is not a running database-backed Realtime application test.

## Applicability, not acceptance

`assessment.json` records each remaining High CVE and its primary advisory.
Two CVEs affect components absent from the image (systemd-homed and Perl
Archive::Tar). Five privilege-related CVEs have explicit profile mitigations,
not patched packages. Four curl CVEs require verification of the constrained
healthcheck-only use. The remaining ncurses finding is in `infocmp`; no reviewed
Realtime application path invokes it, but the vulnerable CLI remains installed.
Do not convert these conditional dispositions into global ignores.

This scanner did not assess Erlang/Elixir application libraries or the compiled
Bun/pgdelta dependency graph. Full-stack websocket delivery, denial tests,
synthetic migrations, resource/load behavior and final live runtime verification
are still required. A zero-High scanner gate has **not** passed. Any acceptance
policy must separately review the precise dispositions; `authorizing` is false.
