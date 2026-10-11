# Test security reassessment — October 11, 2026

Non-authorizing assessment. Findings remain unsuppressed. No renewed risk
acceptance, component replacement or release approval is granted by this file.

## Evidence and exposure

Current live release is 6217cb33bd9aaf32aa0fa924278f314988449f12. Exact backend
artifacts were validated in the native synthetic rebuild recorded in
`test-environment-status.md`. Raw ten-artifact Trivy 0.74 review is private at
`BarberBackups/staging-images/security-review-1791691412370.json`, SHA-256
`8e0c113351c9bf6b63911138eea2cf344369fe3d2a38e236780f34898aa291e3`.
Database updated October 10; scan October 11. Preserve its full findings and
coverage limitations, including lack of complete Elixir/Erlang/Bun coverage and
PostgREST's uncovered package inventory. Zero reported findings is not a full
source/security audit.

The approved exposure remains synthetic data, private Access, internal Docker
networks/no public service ports, separate secrets, sink SMTP, disabled cron and
empty real AI/WhatsApp credentials. The exact signed Meta handlers remain public;
neighboring routes do not. Changing these conditions requires another review.

## Current findings and dispositions

The image build also reported source-map-js 1.2.1 in development tooling
(CVE-2026-93749). The lockfile now selects the compatible 1.2.2 patch; only that
transitive entry changed and npm audit reports zero vulnerabilities. This is
separate from the runtime image findings below. See the
[reviewed advisory](https://github.com/advisories/GHSA-68fv-2mgg-jv7q).

| Artifact | HIGH / CRITICAL | Assessment and required decision |
|---|---|---|
| DB helper, image b8aebc0a… | 3 / 0 | Go 1.27.1 matches 78667, 78669 and 97031. The helper is gosu, a startup UID/exec CLI, not an HTTP/TLS service. Source-path exclusion is a reachability assessment, not a package fix; preserve findings. Patched Go 1.27.2 is available for a future reviewed rebuild. |
| Auth, image aa5adadc… | 5 / 0 | Retained pgproto3 32286 finding needs its existing downstream patch/regression evidence. New Go stdlib findings and x/net 78669 remain; no blanket extension of the prior bootstrap approval. Private Access and internal HTTP reduce exposure but do not prove every library path unreachable. Require bounded owner disposition or patched/rehearsed replacement. |
| Mailpit, ed9b00c6… | 4 / 0 | Go stdlib 3 findings plus x/net 78669. Sink-only internal SMTP, no published UI and disabled relays limit exposure. Static-file serving makes the Range-header finding relevant to the UI if exposed. Require bounded owner disposition or patched/rehearsed replacement; never expose the sink to solve access issues. |
| Existing frontend, 4d656e8c… | 1 / 0 | TIFF package finding remains in the deployed artifact. PR #6 includes the supported pinned TIFF update; the final newly published artifact still needs a current scan before acceptance. |
| Realtime, 78f25384… | 54 / 0 | Existing 52-match/12-advisory assessment and controls remain. Two additional HIGH GnuTLS certificate-validation findings need explicit disposition. Their library remains present; no claim it has been patched. |

For Realtime, retain the individual October 4 dispositions in
`ops/staging-vps/realtime-security/assessment.json` and owner record unchanged.
The new findings are CVE-2026-88647 and CVE-2026-88648. They concern hostname and
certificate-chain restrictions; see [88647](https://nvd.nist.gov/vuln/detail/CVE-2026-88647)
and [88648](https://nvd.nist.gov/vuln/detail/CVE-2026-88648).
Live ldd shows Beam itself does not link GnuTLS; curl loads it transitively.
The allowed curl healthcheck is a new process with fixed loopback HTTP, `-q`,
`--noproxy '*'` and `--proto '=http'`. It does not verify a TLS certificate.
This supports a conditional no-reviewed-TLS-path disposition; it is not a full
proof against arbitrary code execution or newly introduced consumers.

Go source advisories: [Range CPU exhaustion](https://pkg.go.dev/vuln/GO-2026-6609),
[HTTP/2 peer CPU exhaustion](https://pkg.go.dev/vuln/GO-2026-6611), and
[TLS ECH memory amplification](https://pkg.go.dev/vuln/GO-2026-6607).
The documented fixes are Go 1.27.2 (or the corresponding maintained older line)
and x/net 0.60.0. A new tag alone does not demonstrate compatibility or a fix in
the artifact actually deployed.

## Proposed bounded decision

If the owner chooses a temporary acceptance rather than component remediation
before this transition, bind it to the exact DB/Auth/Mailpit/Realtime identities
above, each listed advisory and the existing Realtime per-advisory controls.
Limit scope to private synthetic Test, preserve scanner output, keep real
integrations/production excluded and keep the existing deadline
**October 18, 2026 at 03:00 Kuwait**. This does not extend that date or authorize
unreviewed future findings/images. The frontend TIFF fix still requires final
artifact validation. This document proposes the decision; it does not record
owner acceptance or set dispositionsComplete=true.

Until dispositions are complete, monitoring must report the security check as
failed and release acceptance remains blocked. Expiry escalates; it never
silently authorizes a shutdown, upgrade or renewal.
