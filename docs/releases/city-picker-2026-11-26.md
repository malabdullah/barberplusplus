# City-picker production release — 26 November 2026

Status: deployed and verified. This record describes the observed release,
not an instruction to deploy its documentation commit.

The customer booking finder uses a separate governorate selector, searchable
city checkboxes and explicit Show shops / Show barbers actions. Changing the
governorate clears selected cities and hides earlier results. The three booking
entry journeys and existing discovery API remain intact.

## Source and artifact

- Feature integration: [PR 181](https://github.com/malabdullah/barberplusplus/pull/181).
- History-only reconciliation: [PR 184](https://github.com/malabdullah/barberplusplus/pull/184).
- Production release: [PR 183](https://github.com/malabdullah/barberplusplus/pull/183).
- Main: `63c90e40ba07e89d406586455f98cca56a040177`.
- Dev: `99993cf7f48b36478f9b736b862ca387e336b822`.
- Both source refs have tree `c353583723f7a284b58df1f6b5423f7abbbf62ab`.
- Successful production workflow: [45810385554, attempt 1](https://github.com/malabdullah/barberplusplus/actions/runs/45810385554).
- Image: `ghcr.io/malabdullah/barberplusplus@sha256:a5cc1c28927da1233ed9cc0637c6385cd58e9a29b53dcf1874a2f48667654260`.
- Release manifest SHA256: `fbf03a38bcd589fbcbe402cfaa8d83e930ad0656a4c572a7180ee098a1abfcc5`.

GitHub artifact attestation passed the repository, workflow, source-commit and
hosted-runner policy. The normal release controller deployed the application.
Read-only verification matched its completed receipt, desired service image,
running task, running container and pulled image identity. The controller timer
remained active. The ledger retains 171 migrations: no SQL or Function source
changes were included. Existing payment pilots and native apps stay unchanged.

## Verification

Required application, browser, database, dependency, secret and documentation
checks passed. Focused local evidence includes 593 frontend tests, 350 Function
tests, 84 operational checks, lint and build. Hosted Test covered the three
entry journeys, multiple cities within one governorate, clear/switch behavior,
optional barber-city selection, English/Arabic, light/dark and narrow layouts.

Production HTTPS checks returned 200 for the home, booking, login, health and
runtime-config routes. The public runtime matched the release commit. An
isolated anonymous Chrome session verified:

| Scenario | Observed result |
|---|---|
| Al Asimah → Sharq → Show shops | Atlas Grooming — Sharq returned |
| Change governorate to Hawalli | Previous city selection and results cleared |
| Hawalli → Rumaithiya → Show shops | Atlas Grooming — Rumaitheya returned under Rumaithiya |
| Clear selection | Returned to the three booking choices |

Only one publicly available city exists in each of these governorates at this
observation; the two-city same-governorate scenario was therefore verified on
hosted Test rather than claimed as a Live test. No booking or customer record
was created by the Live smoke.

The existing Super Admin session in the shared in-app browser received a generic
customer-discovery error. Anonymous discovery and the separate public customer
browser flow passed. Shared work/customer token handling and administrative role
exclusion predate this frontend release; owner sessions were not signed out or
modified. Treat that staff-session behavior as a separate follow-up.

Temporary frontend verification access was closed: the original firewall profile
was restored, the added source rule was removed, all five original rules remained
and a subsequent TCP 22 probe timed out. No database SSH was used in this window.

The prior compatible rollback artifact remains the independent release image
`ghcr.io/malabdullah/barberplusplus@sha256:97c32f4010ea909400599d8a4a038d49d3461b1a45c4cb9c834fd3ad1e1424e3`.
Rollback was prepared but not executed. This record does not authorize SQL
reversal, payment activation or native publication.
