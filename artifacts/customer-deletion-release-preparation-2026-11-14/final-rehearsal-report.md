# Final account-deletion rehearsal

Completed14 November2026. **PASS — final exact-source rehearsal gate complete.**
This does not authorize production deployment, credential use, policy publication
or App Store submission.

Frozen source: `e32cfb9105c2652fab8c2065af7280bf7dc76ec9`.
Review manifest SHA256: `9bde582ac5558ad6a4e026b47520ec454192cb41f8fbabc8fb3f418ec6b22bd7`.
No source changes or fixes were needed during this run.

| Scenario | Result |
| --- | --- |
| Pinned PostgreSQL/Auth/Storage startup and official Auth migrations | PASS |
| Explicit linux/amd64 variants for all four pinned runtime references | PASS |
| Previously reviewed baseline56 relations/15 routine hashes/49 policies | PASS; zero differences |
|102 unchanged main migrations +9 core/Apple migrations replay | PASS |
| Public schema reconciliation | PASS |
| All48 SQL suites | PASS;1,144 assertions |
| Real pinned Auth API creation/sign-in with synthetic users | PASS |
| Actual Storage upload/read and wrong-owner denial | PASS |
| Atomic cancellation; old refresh/JWT Storage access revoked before cleanup | PASS |
| Interrupted cleanup/backoff/fresh lease/stale-worker denial | PASS |
|501 objects; bounded500+1 cleanup, missing files and repeated deletes | PASS |
| Actual Auth/Storage removal and sessionless receipt recovery | PASS |
| Other account unaffected; anonymous past value retained; future bookings cancelled | PASS |
| Ratings/favourites/queued booking emails removed for the fixture | PASS |
| All16 Edge workers compile and expected closed handlers execute | PASS |
| Deletion default off | Exact503 `NOT_ENABLED` |
| Read-only lookup handler |200 |
| Independent before/after Docker inventory | Identical identifiers; no new resources remain |

Existing resources preserved:10 containers,62 images,9 volumes and4 networks.
The harnesses removed only their own disposable containers/network. There was no
ordinary local website/Test stack, published host port, production data/credential,
real Apple/mail/push call or existing Test reset. Cron stayed disabled on the
synthetic platform. No dev/main push, Live connection or public copy publication.

Docker on this Mac has a multi-platform image store. The generic image view can
show an index or a host-default variant; final verification explicitly used
`docker image inspect --platform linux/amd64`. Both harnesses requested that same
platform. The cleanup evidence records the pinned parent references and selected
AMD64 image IDs rather than mislabeling the default Mac view as the tested image.

## Evidence limits and remaining work

The baseline comparison reuses the previously approved schema-only catalogue;
it is not a new live production ledger/runtime inspection. Real Apple exchange/
revocation was proven separately on Test with account preservation. This rehearsal
uses synthetic Apple/task fixtures and injected provider checks; it does not
claim a real Apple-backed account deletion or Live credential verification.
Duo final destructive journey coverage remains as documented in the review plan.

Remaining production gates are Live Apple credentials/client verification and
renewal/encryption recovery, owner acceptance of public copy/native disclosures,
fresh live ledger/runtime/backups/cron checks during an approved release, then
explicit dev→main→production deployment approval and post-deploy verification.
Native upload/submission/public release remain separate approvals.

The original review manifest is unchanged. The
[receipt](final-rehearsal-receipt.json) binds it to the machine-readable
[platform](final-platform-results.json), [Edge](final-edge-results.json) and
[cleanup](final-cleanup-results.json) evidence.
