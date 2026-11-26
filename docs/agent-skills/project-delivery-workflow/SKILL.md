---
name: project-delivery-workflow
description: Set up or follow a project's GitHub delivery workflow with PRs, CI, hosted Test verification, database migrations, backup recovery, and owner-approved production releases. Use when establishing project delivery rules or carrying a requested change through this workflow, rather than for unrelated GitHub explanations or read-only reviews.
---

# Project delivery workflow

Deliver requested changes through verified hosted Test and a reviewable PR. By default, wait for explicit owner authorization before merging into a production-triggering branch or publishing to production. A request to fix something authorizes normal development delivery, not production release. Honor existing explicit authorization without asking again. Current owner instructions and project policies take precedence over these defaults.

## Establish the project contract

Read applicable AGENTS.md files, repository status, workflows, deployment and recovery runbooks. Identify the stack, repository, branches, hosted Test and production targets, database identities, required checks, deployment triggers and authorization. Use available provider tools and specialist skills as appropriate. Never import Barber++ URLs, credentials, infrastructure, nightly backup frequency or coordination rules into another project.

Distinguish setup from ordinary development. A setup request authorizes preparing and configuring the requested workflow within existing permissions. An ordinary fix uses the established workflow; it does not authorize unrelated provisioning, purchases, platform upgrades or release-policy changes. Continue independent work while seeking genuinely missing information.

For setup, implement the applicable parts rather than only recommending them:

- Establish the repository and meaningful CI checks. Protect the release branch with PR review and required checks where supported; verify enforcement and report unavailable protections.
- Establish separate hosted Test and production environments with distinct databases, credentials, storage and integration settings where applicable. Use synthetic Test data, sandbox payments and controlled message recipients. Never copy production customer data into Test. Hosted Test is the default; use localhost only when requested or explicitly established by project policy.
- Agree the acceptable data-loss window and recovery time with the owner before choosing backup frequency. Set up encrypted automatic off-host backups for the database and necessary files/configuration, independent protected recovery-key custody, failure/freshness monitoring, retention and isolated restoration tests. Identify costs and account constraints before committing to them.
- Document deployment order, release identity, previous artifacts, database compatibility, recovery and production checks. Inspect production triggers before connecting CI/CD.
- Persist concise project-specific rules in AGENTS.md and maintained runbooks, preserving unrelated instructions. Include actual commands, targets, approval boundaries, required evidence and a reference to this skill so future chats can follow the policy. Store secret references, never values.

Distinguish configured, observed working and blocked items. Do not claim setup complete while required infrastructure, restoration proof or branch enforcement is unverified. Documentation alone does not install infrastructure.

## Deliver an ordinary change

1. Define expected behavior and affected roles, data and integrations. Preserve unrelated work and use a feature branch or isolated worktree when needed.
2. Implement the scoped change. Keep database structure and permission changes in versioned migrations. Prefer compatibility with the previous app; use staged expand/migrate/contract changes when necessary. Separately review destructive or incompatible migrations and platform upgrades.
3. Run required builds, lint and meaningful affected tests. For database changes, test migration application, existing-data compatibility and access-denial paths. Documentation-only changes need only applicable checks, not unchanged-app deployment.
4. Commit focused changes, push the feature branch and open/update a PR as part of delivery unless restricted by the owner. Exclude secrets and unrelated files. Inspect workflow triggers first: if a push publishes to production, use a safe branch or wait for release authorization.
5. Deploy matching application, migrations and backend functions to hosted Test in the appropriate order. Verify affected journeys, roles, permissions, responsive layout and supported languages where relevant. A build or green CI does not replace hosted verification.
6. Wait for required CI and complete the required review process. Ensure the tested release matches the final PR version. If it changes, repeat affected checks; establish applicability before reusing older evidence.
7. Present concrete approval evidence: PR, commit, required check results, hosted Test identity and observations, database/integration effects, unresolved risks and recovery readiness. Report blockers and continue unaffected work. Never label incomplete verification as ready.

Ordering can adapt to the repository; evidence and authorization boundaries cannot be skipped. Continue through feasible authorized delivery work rather than stopping after code edits.

## Release after authorization

Complete all authorized preparation before requesting approval and show the exact reviewable version and scope. Treat merge as a release action when it triggers production. Approval for that version authorizes the documented normal release and verification; do not repeatedly ask for the same scope. Material unreviewed changes require renewed approval.

Verify exact commits/artifacts, relevant backup freshness and restoration evidence, ordered migrations, compatibility and previous working artifacts. Never infer backup health from a schedule or example receipt. Deploy approved database/backend/frontend changes in documented order. Verify actual production release identity and affected service health afterward. Production checks are read-only unless specific disposable records, sends, payments or other mutations are authorized.

On failure, stop automatic retries and inspect actual deployed state before proceeding. Use the documented authorized recovery procedure for compatible previous app/function artifacts, preserving customer writes. Never automatically reverse SQL or replace the database with an older backup as part of app rollback. Database disaster recovery requires separate review and authorization of the recovery point, potentially lost bookings/orders/edits and reconciliation plan. Failed backups increase possible loss beyond the nominal schedule. App rollback does not repair data already damaged by faulty code.

## Completion evidence

Use plain language. Report what changed, commit/PR, checks, observed Test deployment, production state and blockers. Distinguish ready for review, verified on Test, approved, deployed and verified in production. Give actual timestamps and recovery evidence for backups; label historical records and unverified live state. Never claim success merely because a command was dispatched.
