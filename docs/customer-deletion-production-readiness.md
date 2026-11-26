> **Historical preparation/evidence — not a current execution instruction.**
> Preserve the original record below. Read [the handoff](handoff.md) and the current PRD,
> runbooks, target identity and approved release receipt before acting. A candidate,
> old approval or preparation checklist does not establish current production state.

> Updated successor for review (14 November 2026): see [final contract](customer-account-deletion-release.md). Earlier evidence below predates the production-compatible Apple additions and is not final release authorization.

# Customer account deletion: production preparation

Status on 13 November 2026: owner accepted the hosted Test/native flow and
approved production preparation. **Production deployment and App Review submission
are not approved.** Reports phase 1 remains a separate unreleased feature.

## Prepared and verified

The default-off candidate is isolated on `codex/customer-deletion-production-candidate`,
based on production main `55f7bb615cdd00d632e64d7eb352210c20854c34`.
It adds only customer deletion, public support and matching privacy disclosures;
Reports routes/services/migrations are excluded. The Test-based mail candidate is
`codex/customer-deletion-mail-candidate`. Neither candidate changes dev or main.

- Production mail adapter is implemented: the existing approved Resend sender
  `Barber++ <noreply@barberplusplus.com>`, Zoho support Reply-To, branded English/
  Arabic proof email, deterministic per-operation/send-generation idempotency,
  bounded timeout, no automatic retries and safe generic errors. Provider tests
  are injected mocks; no real deletion email was sent.
- Function v3 and environment-binding migration are deployed on hosted Test only.
  Test remains pinned to `qvkucvcjmojjbphlzlks`, capture-only and restricted to
  trusted disposable QA identities. Captured branded Arabic mail, stable duplicate
  start/receipt and valid proof were checked; the owner-review account was preserved.
- Production activation requires exact site/API/backend binding, immutable database
  deployment identity and **both** new-request and cleanup switches. Both switches
  default off. Cleanup-only mode preserves accepted jobs and receipt recovery;
  operator configuration refuses to abandon pending cleanups.
- Main-based candidate checks: lint, 232 Function tests, 356 UI tests, 65 operational
  tests and production build passed. The scoped business SQL assertions passed on
  hosted Test inside a fully rolled-back transaction, with no Reports dependency.
- All 16 workers passed compilation/closed-handler checks on the pinned official
  Linux amd64 Edge image in `ops/release/runtime-lock.json`. Deletion returned the
  exact default-disabled `503 NOT_ENABLED`; the read-only lookup returned 200.
  Only synthetic settings were used, no public ports, credentials or real messages.
  The disposable container was removed. This is **lock-image compatibility**, not
  attestation of the image currently running on the server.
- Native flow passed on 17 Pro and 16e, including purpose-bound proof, two explicit
  future cancellations, anonymous past history, switched-account isolation and
  lost-response receipt recovery. Duo deletion-specific coverage was not completed in that run;
  no Duo deletion-specific pass is claimed. No upload/install/submission is included.

## Production inspection outcome

The approved read-only DB inspection completed on 13 November before the
16:02:44 UTC deadline. The existing migration key worked after the owner chose
the firewall route; no password reset or SSH authentication-policy change occurred.
Actual PostgreSQL, Auth, Storage and Edge containers were healthy and matched the
four pinned image IDs. PostgreSQL reports 17.6. Metadata covered 56 relations,
15 routine hashes and 49 policies; all 15 selected routine hashes reconcile with
main source (including existing package patches). This is selected catalogue
verification, not the full migration ledger or a production schema export.

The observed internal backend is `http://api-gw:8000`. The candidate now pins this
exact alias, still requiring an explicit matching binding and both default-off
flags. The 23 affected Function tests and hosted Test v3 captured-mail/proof checks
passed. Production flags and the new binding remain absent; production is unchanged.
No customer rows, secret values or routine bodies were exported.

Original database firewall profile 367995 was restored and observed Active.
Temporary profile 394280 is inactive and contains only its five original rules;
the added operator TCP22 source was removed. Frontend access was never opened.
SSH processes completed; no persistent connection or console session remains.
Safe aggregate evidence is `artifacts/customer-account-deletion-2026-11-13/production-readiness-summary.json`.

## Completed database/Auth/Storage rehearsal

The owner-approved isolated rehearsal is complete. Stock exact production images,
official Auth migration bootstrap and the committed main baseline reproduced all
56 selected relations, 15 routine hashes and 49 policies with zero differences.
All main and six deletion migrations replayed; the public expected schema now
matches. All 47 SQL suites passed (1,136 assertions). Real Auth/Storage APIs passed
old-session/refresh revocation, 501-object bounded cleanup, interrupted cleanup,
backoff, stale-lease rejection, receipt recovery and other-account isolation.
No production schema dump was needed. Temporary resources were removed and their
absence independently verified. See the detailed [rehearsal report](../artifacts/customer-account-deletion-2026-11-13/platform-rehearsal-report.md).

## Remaining release gates

1. Owner approval of the immutable release artifact and privacy disclosures before
   dev → main → production. Reports stays excluded. No production deployment or
   native upload/submission is authorized by this rehearsal.
2. During an approved release, verify the applicable live migration ledger and
   current runtime/configuration against the manifest. Selected catalogue parity
   and a complete source replay do not attest an unexported live ledger.
3. Review backup/restore readiness, cleanup secret/cron, receipt expiry, no-PII
   monitoring and disable procedure. Stop new requests while keeping cleanup on
   until accepted work finishes; anonymization cannot be reversed by a flag.
4. Accept public privacy wording and native App Privacy disclosures. Automatic
   Apple revocation is absent; manual Apple Account revocation remains the fallback.
   Duo deletion-specific coverage remains unclaimed. No legal or App Store acceptance implied.

Already delivered emails, downloaded exports, external copies and provider/backups
cannot be recalled by this feature. No arbitrary legal retention period is claimed.
