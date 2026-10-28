# Cloud development and production handoff

This candidate adds disposable Codex cloud development tooling. It does not
replace or modify the existing hosted Test service or production deployment.
Cloud test receipts are evidence for review; they are not deployment credentials
or production authorization.

## Change workflow

1. Start a feature branch from the reviewed cloud-readiness candidate until this
   tooling is merged; afterward use current `main`. Initialize the cloud Test
   profile using committed migrations and synthetic seed data. Never copy a live
   database.
2. Implement and run the repository checks, database replay/security tests and
   affected browser journeys. Test may be reset; retain source changes in Git.
3. Commit the candidate. Initialize a separate cloud Staging profile from that
   exact commit. Record its runtime lock, migration tree, frontend and Function
   source identity, test results and private-browser acceptance.
4. Review the candidate PR and CI results. Any code change invalidates acceptance
   of the previous commit and requires the affected checks to be rerun.
5. Only after the production bridge below has been implemented and verified can
   cloud acceptance contribute to production promotion. Use the existing release
   record for backup, migration, rollback and release-specific approval gates.

Changing a booking in a cloud browser changes only that profile's synthetic
database. It neither changes source code nor publishes a production release.

## Release bridge gap found on 2026-10-28

Audited base: `c82c6539ed1fd2db6eb39bd0dd7c7569bc938877`.

The current `deploy-staging.yml` produces attested
`staging-release-request-<commit>-<run>-<attempt>` artifacts and immutable frontend
and Functions images. It deliberately does not deploy a server. In contrast,
`deploy-production.yml` searches that workflow for `accepted-release-<commit>`
containing `accepted-release.json`, and checks the old hosted staging URL.
The current producer and consumer therefore do not form a cloud promotion path.
Do not work around this by renaming a release request, manufacturing an accepted
manifest, disabling the staging check or supplying a mutable image tag.

## Required bridge contract

The future cloud acceptance workflow and production consumer must be reviewed
and activated together. Existing deployment workflows are not altered by this
candidate.

| Input | Required verification |
| --- | --- |
| Source | Exact repository, protected `main` commit, reviewed PR and successful required CI checks |
| Build | Frontend and Functions image digests, verified GitHub provenance, source commit and workflow run/attempt |
| Database | Exact migration names/hashes, clean synthetic replay, RLS/pgTAP tests and schema comparison |
| Cloud runtime | Pinned component versions and verified hashes, separately recorded native compatibility and deployed-image parity |
| Staging acceptance | Isolated Staging profile bound to the same commit/artifacts, role/browser/API tests, private HTTP and WSS access checks |
| Review evidence | Reviewer, timestamp, candidate identity and immutable receipt digests; a JSON `PASS` value alone is insufficient |
| Promotion | Same accepted frontend and Functions artifacts; no rebuild between acceptance and production |
| Production preparation | Fresh backups, restore evidence, reviewed migration plan, current rollback target and monitoring |
| Authorization | Owner approves the concrete version/commit/digests and the protected production deployment |

Use a dedicated acceptance artifact schema carrying both image digests and the
migration tree. Its source workflow and repository identity must be verified
independently of artifact-supplied fields. The production workflow must retrieve
that exact accepted artifact and reject a stale, missing, changed, foreign or
replayed candidate. It must not depend on a one-hour browser tunnel remaining
online after review.

Before activation, exercise negative cases for mismatched commits, images,
migrations, workflow runs/attempts and reviewers, plus a complete non-production
promotion rehearsal. A native backend compatibility result must never be labeled
an exact deployed-image test. If runtime parity remains unresolved, production
readiness remains blocked even when cloud editing and previewing work.

## Existing release controls

Continue to use [release records](releases/README.md), the
[release template](releases/template.md), [backup and restore](backup-restore.md),
and the [deployment runbook](deployment-runbook.md) for their applicable release
controls. Historical Mac/VPS procedures are not commands for the new cloud
profiles. No production tag or version has been selected or authorized here.
