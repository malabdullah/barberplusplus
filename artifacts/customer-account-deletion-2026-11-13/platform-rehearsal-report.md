# Customer deletion database/Auth/Storage rehearsal

Completed 13 November 2026. **PASS — ready for owner review; no production activation.**

| Scenario | Result |
| --- | --- |
| Exact PostgreSQL 17.6.1.136, Auth 2.189.0 and Storage 1.60.4 image IDs | PASS |
| Fresh stock platform bootstrap, official Auth migrations, all committed main + six deletion migrations | PASS |
| Selected production baseline: 56 relations, 15 routine hashes, 49 policies | PASS; zero differences |
| Public expected-schema reconciliation | PASS; only equivalent role-list ordering normalized |
| All 47 database suites | PASS; 1,136 assertions |
| Real Auth creation and password sign-in; authenticated role/session claims | PASS |
| Real private Storage upload/read; another customer's access denied | PASS |
| Deletion cancels two future bookings atomically; retains anonymous completed booking value | PASS |
| Old refresh token and old JWT Storage access rejected before physical file deletion | PASS |
| Incomplete cleanup stays pending; concurrent claim denied; backoff and fresh lease | PASS |
| Stale worker cannot finish; receipt recovers after Auth deletion | PASS |
| 501 objects split into batches of 500 and 1; orphan files and repeated deletion | PASS |
| Actual Auth hard delete, repeated Auth delete and Storage delete | PASS |
| Other signed-in customer unaffected; ratings, favourites and queued booking mail removed | PASS |
| Scoped rehearsal containers/network removed | PASS; independent inventory empty |

The 501-object case uses one real uploaded file and 500 synthetic metadata-only
orphan objects, covering the cleanup boundary and missing-file recovery together.
Bulk deletion exceeded the probe's original 10-second timeout. The probe now allows
60 seconds for that call, below the worker's two-minute lease; the full case passed.
This is compatibility evidence, not a production throughput benchmark.

## Corrections made

The isolated bootstrap now runs the exact Auth image's official migration command
before starting its API and issues the normal authenticated JWT role. No invented
Auth schema stubs or production changes were used. Eight legacy SQL suites were
updated for the new restrictive live-session policies: successful staff fixtures
have transaction-owned sessions, while missing-session, wrong-owner and other
negative checks remain intact. The baseline now explicitly checks the four
published-table read guards and Storage read/write guard. The expected public
schema includes the six deletion migrations. No application permission was weakened.

## Isolation and evidence

No production records, secrets or database dump were used. Fresh synthetic keys,
users and bookings ran on an internal-only Docker network, with no published
ports, active cron or real messaging. Existing local Test resources were preserved.
The ordinary local website was not started. Hosted Test's previously verified
application/Function v3 remains unchanged by these test and operations edits.

[Machine-readable results](platform-rehearsal-results.json) contain every suite,
image digest and source migration manifest hash. The prior pinned Edge rehearsal
covered all 16 workers and default-disabled deletion. Remote dev remains
`0a5da719201b2ec3162dbea89b69ff835c73cb3d`; main remains
`55f7bb615cdd00d632e64d7eb352210c20854c34`.

## Limits and next approval

Selected live catalogue metadata matched the rebuilt baseline; a complete live
production schema/ledger was not exported or attested. Live Google/Apple provider
flows and Realtime WebSocket transport were not part of this portless rehearsal.
Database read policies and real Auth/Storage revocation were checked. No new native device check or App Review submission is included. Earlier
deletion-specific passes cover 17 Pro and 16e; a Duo deletion-specific pass is not
claimed. Separate Duo navigation work uses its own evidence.

Production remains disabled and unchanged. Owner review of the release artifact,
privacy disclosures and activation/cleanup runbook is required before any dev →
main → production release. The normal release procedure must verify the applicable
live migration ledger, backups, dispatch configuration and pending-cleanup safety;
this report does not authorize a live deletion demo or real messages.
