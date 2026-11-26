> **Historical preparation/evidence — not a current execution instruction.**
> Preserve the original record below. Read [the handoff](../../handoff.md) and the current PRD,
> runbooks, target identity and approved release receipt before acting. A candidate,
> old approval or preparation checklist does not establish current production state.

# Android Live backend candidate — Test review

Prepared 20 November 2026 from released main `c6efbb63a2ef6643b1ff0485d22b6c6ff01ad364`. No settlement, billing-demo or other unreleased feature is included in this Live candidate. No dev/main push, production deployment, provider login, real email/push or personal-account change occurred in this pass.

The exact additive database, RLS/grant, routine, trigger, Function, cron, public provider identity and rollback scope is in `configuration-manifest.json`. Installed Test readback is in `hosted-test-result.json`. This is ready for coordinator review of the next release gates; it is not proof that Live Android authentication or delivery is activated.

## Verified

| Check | Result |
| --- | --- |
| Native signup/recovery database protocol | 42 assertions passed; fixtures rolled back |
| General Android registry/queue database protocol | 44 assertions passed; fixtures rolled back |
| Deno Function tests | 336 passed; lint and type checks passed |
| Frontend tests | 96 files / 530 tests passed |
| Operational unit tests | 83 passed after allowing their isolated mock loopback servers |
| Auth/booking helper tests | 33 passed, including all three Play signing SHA-256 associations and unchanged iOS AASA behavior |
| Exact Auth glob dependency | 35 checks / 5 proposed URL patterns passed with gobwas/glob v0.2.3 and separators `.`/`/` from Auth v2.189.0; zero provider calls |
| Build, migration names and environment-neutral domain guard | Passed; existing large-bundle warning remains |
| Hosted customer-auth | v41; every uploaded dependency byte-matched source on readback |
| Hosted Android dispatcher | v4; every uploaded dependency byte-matched source on readback |
| Hosted negative requests | Missing customer identity denied; malformed native email/recovery denied; guest push denied; direct Function and website gate denied unauthenticated requests |
| Hosted Test auth helper | Fixed credential-free fallbacks, malformed input denial and existing single Test signer verified |
| Privacy Test carrier | Both EN/AR objects exactly match the Live candidate; hosted payload checked; settlement routes/source and access gate preserved |
| Final Test state | New registry and queue empty, fixtures absent, sender absent, flags OFF, cron inactive |
| Existing APNs routines | Fingerprint unchanged: `e86f9d42fff4b96de0227e153f8182bd` |

The first aggregate `npm run check` reached operational tests and encountered sandbox `listen EPERM` for four existing mock-server tests. The operational suite was rerun with scoped loopback permission: all 83 passed. This was not a website/database runtime or Docker session.

The private-table security advisor reports informational RLS-with-no-policy entries for the four new transport tables. This is intentional deny-by-default: direct table privileges are revoked even for service_role; bounded routines own access. No client policy was added to suppress those notices. Existing unrelated project notices were not modified.

## Scenario evidence

- Occupied/ineligible native signup returns HTTP409 `SIGNUP_EMAIL_EXISTS` after email/IP and shared global rate limits; no verification request/handle or mail. The approved existing synthetic staff-email probe confirmed no account/binding/mail/timestamp change. Eligible unconfirmed-customer resume remains supported; no iOS/Web behavior changed.

- Live project/package or unset flags cannot be used against Test. No caller selects a backend, Firebase project, package or sender.
- The gateway derives account and current session; a client-supplied owner is ignored. Cross-account device capability, wrong secret, revoked/foreign session and malformed versions fail.
- Same-version exact retries are idempotent. Changed intent at the same version fails; older registration does not revive a detached installation.
- Registration preserves explicit opt-outs. Incomplete preferences fail. Permission=false suppresses delivery, though explicit Android notification setup can still collect registration identifiers.
- The existing booking trigger supplies the event/revision. A job is leased once and duplicate terminal acknowledgment cannot change it.
- Explicit provider 429/500/503 responses are eligible for bounded backoff, honoring a later Retry-After. An unknown network outcome or expired in-flight lease is terminal uncertain and is not automatically replayed.
- Token rotation invalidates an old lease; an old invalid-token response cannot retire the new registration. Ownership/permission/token/lease are checked again after credential minting immediately before send.
- Capability-only detach and Auth session revocation retire only the affected bindings. The separate Test experiment and APNs queue were unchanged in transaction checks.
- Browser callback returns only a device-bound opaque handle. Arbitrary destinations, extra parameters, mixed environments and session fragments are rejected. Website fallback never adopts an app session.

## Issues caught and corrected before pass

1. PostgreSQL rejects regex repetition counts above 255. Token length is now bounded separately from the permitted alphabet, retaining 20–4096 characters.
2. A PL/pgSQL composite variable hid a recipient SQL alias. The current-device variable now has a distinct name, so recipient jobs materialize correctly.
3. Comparing a `clock_timestamp()` default with an earlier transaction `now()` delayed the initial claim. New jobs now use the transaction timestamp and can be leased immediately.
4. The actual Auth glob parser rejects combined `[0-9a-f]` ranges. Corrected UUID patterns use `[0123456789abcdef]` for every character and passed the pinned matcher checks.

Corrections are explicit follow-up migrations, preserving the exact Test migration history. File SHA-256 values and installed history fingerprints are recorded separately in the manifest.

## Hosted identities

- Test project: `qvkucvcjmojjbphlzlks`.
- customer-auth: see the exact version and bundle digest in `hosted-test-result.json`.
- Android dispatcher: see the exact version and bundle digest in `hosted-test-result.json`.
- Test auth helper Worker: `fdee9cc0-2233-4f46-b286-c23ab65b1a77`.
- Privacy-only Test carrier: `cacdab3`, based on settlement `b35d938`; Worker `3492709d-8942-4ff5-a6e0-d99dc6527e38`.
- Carrier asset: `/assets/main-DMhFNGHE.js`, SHA-256 `38eb5a003ec0358c366e70a04430dd245762678d52dc6d0d4372b8e277f41e4f`.

The privacy carrier changes only the two `customerPrivacy` translation objects. It does not pull settlement source into this Live candidate or replace the Test site with released main.

## Remaining review gates

1. Review this immutable candidate and CI. The exact production-image/database/schema replay has not been performed in this scope: no Docker/local Test runtime was authorized. Updated public schema expectations and a fail-closed Android image probe are prepared, not claimed image-tested.
2. Review and deploy the new Live auth helper plus additive booking assetlinks; append only the five corrected Auth redirect patterns. Retain the existing iOS/Web provider audiences, callbacks, Site URL and AASA. The public Google/Firebase registrations were performed by the coordinator under the owner's separate approval.
3. Install only the coordinator-custodied send-only FCM JSON and separate Android wake secret on the server; verify identities without exporting values. No Live credential belongs in Test, Git or either client app.
4. Apply the seven additive migrations and matching artifact with activation flags OFF and cron inactive. Then review staged registration/delivery activation separately.
5. Obtain approval for the smallest real Play-delivered sign-in, link and notification/tap checks. No real notification was sent here. Keep guest push and arbitrary Admin announcement destinations out of the claim: the current Android client supports signed-in booking notifications only.

Rollback first disables only Android flags/cron and restores prior Function/website/Worker versions. Retain additive database rows and terminal delivery states; do not drop tables, replay historical events, revoke iOS keys or reset accounts.

## CI correction evidence

Initial review head `fd2b6fe` run `44771700802` found three integration issues: the image-probe source test required its original deletion conditional; the release-only database fixture lacked older Test-experiment tables; and Gitleaks classified two literal PEM parsing/test expressions plus two public bundle digests as secrets. The image conditional is preserved with an additive Android branch; the SQL test conditionally verifies Test-only tables and uses a transaction-only synthetic binding in CI. The scanner remains fully enabled with four exact historical commit/path/rule/line false-positive fingerprints only, and public digests now live in the structured receipt. No sensitive scanner value is reproduced here. Final CI outcome must be recorded against the latest immutable source, not these failed/superseded runs.

A final body comparison also found a redundant client-equality condition on the already-updated Test password routine. The seventh guarded migration removes only the exact duplicate and is a no-op on fresh production. All six changed public routine bodies now match the hosted Test/expected source exactly; original migration history is retained.

The coordinator-requested pre-send credential regression also passed: token acquisition failure invokes send zero times and uses only the existing bounded Live backoff; a possible send exception remains terminal uncertain. No migration/timing policy or real runtime probe was added. The Test dispatcher is v4 with exact source readback.

The released restricted helper has only receive/preflight/apply/rollback modes; automatic preflight intentionally refuses this DDL. A separate operator-reviewed adoption/reconciliation entrypoint is not defined in the current repository runbook. The coordinator has been asked for its existing source/hash receipt; no helper/controller/Dokploy change or bypass was made. This remains a concrete promotion gate, not an assumed supported command.
