---
name: full-regression-testing
description: Prepare, maintain, or explicitly run a project's full functional regression plan across roles and shared journeys, recording version-bound results and coverage gaps. Explicit invocation only; ordinary fixes, pushes, PRs, CI success, or requests to create a plan do not start a full regression run.
---

# Full regression testing

## Invocation and scope

Run the full suite only when the owner explicitly requests a full regression run or invokes this skill to run it. A request to create/update the skill or a plan authorizes preparation only. Never attach the full run to ordinary changes, CI push/PR triggers, schedules or the general delivery workflow. Focused checks required by normal development remain unchanged. If adding a GitHub entry point is explicitly requested, use a manual trigger only and verify no automatic trigger invokes the full suite.

This is functional regression testing, not proof of every possible case, a penetration test, load test, production release, disaster recovery drill or native-app test campaign. Do not expand into those tasks or fix discovered bugs without authorization. Full means the agreed versioned inventory, not an arbitrary sample or just the existing automated files.

## Prepare or maintain a project plan

Read project instructions, supported roles, routes, services, feature flags, existing tests, release documentation and environment boundaries. Prefer the exact deployed release's source over an unrelated checkout. Locate an existing plan at docs/testing/full-regression.md or the established project location. If absent, adapt [assets/plan-template.md](assets/plan-template.md) to actual behavior. Keep the plan in the project's repository, not the global skill. Do not copy Barber++ roles, targets or credentials into other projects.

Inventory normal, invalid, boundary, permission, cross-role, retry/race and persistence cases. Include relevant UI responsiveness, accessibility basics and supported languages. Record stable IDs, priority, fixtures, steps, observable expected outcomes and execution/evidence mappings. Existing automated coverage is credited only after reading the actual assertions and configuration; file existence alone is insufficient. Use manual or hybrid execution for gaps instead of inventing coverage. Do not build an entire new automation framework unless requested.

Separate core release behavior from optional/flagged features. Resolve ambiguous expectations against requirements or ask the owner; do not invent business rules to make tests pass. Snapshot plan revision and applicability before each run. A new feature needs scenarios, not just an unexplained exclusion.

## Preflight for an explicitly requested run

- Confirm hosted Test URL, backend/database identity, frontend commit or artifact and backend/migration versions. Record dirty checkout state and mismatches. Never change/deploy the tested version merely to make it match local code without authorization. A full-run request alone does not authorize production writes or release actions.
- Inspect commands/configuration before running. Avoid commands that start localhost/Docker when project policy requires hosted Test. Verify synthetic credentials, email sinks, sandbox payments, webhook destinations and all network targets. Missing access is BLOCKED, not a reason to use production credentials/data.
- Use isolated test accounts and a run ID with exact fixture IDs. Save pre-existing preferences and use a cleanup manifest. Do not reset the shared database or delete someone else's fixtures. Synthetic Test mutations within the plan are part of an explicitly authorized run; real payments/messages, destructive infrastructure changes and production mutations are not.
- Record browsers, viewport sizes, locales, time zone and roles. Begin only after target identity and safe side-effect boundaries are established. Continue independent safe checks if another area is blocked.

## Execute and record

Create a run report using [assets/report-template.md](assets/report-template.md), defaulting to docs/testing/runs/<timestamp>-<run-id>.md unless the repository specifies otherwise. Start every applicable case as NOT RUN. Reuse safe automated suites and execute missing cases through hosted UI/API/database checks with the appropriate available tools. Do not substitute unit tests for a real multi-role journey. Exercise each applicable role and the end-to-end lifecycle, including forbidden access and duplicate/retry behavior. Role-changing tests must use isolated sessions.

For every case, record PASS, FAIL, BLOCKED, NOT RUN or NOT APPLICABLE, the variant tested, timestamp and evidence location. NOT APPLICABLE needs a version/flag-based reason; BLOCKED needs a dependency. A manual action is not a pass until its expected outcome is observed. Keep transcripts/screenshots/results redacted; never commit secrets, customer data or raw session state. Link durable CI evidence where relevant and identify local-only evidence that is not on GitHub.

Capture reproducible failures with expected/actual results, role, release identity, severity, fixture references and safe evidence. Confirm a failure only as far as useful; preserve initial failures and retries rather than rerunning until green. Stop unsafe cases on unexpected outbound activity, identity drift, data damage or side effects outside the fixture manifest. If another deployment changes the target mid-run, segment results by version and rerun affected cases before claiming one version passed.

Clean up only run-owned records and restore recorded preferences. Verify cleanup; unresolved cleanup is an explicit blocker. Do not erase evidence or original shared records.

## Report outcome

Summarize counts by status and role, coverage gaps, critical failures, manual checks still needed and cleanup. Counts include all planned variants, with exclusions visible. Report FULL PASS only when all applicable required cases passed on the stated version, no required cases are blocked/unrun and cleanup is complete. Otherwise report FAIL or INCOMPLETE; a percentage cannot override a critical failure. A later fix needs an explicit scoped retest or full rerun request; do not silently launch another full campaign.

Provide a release recommendation tied to the tested scope and evidence. Passing the plan is not release approval and does not prove unrelated features, native apps, integrations or backups are healthy.
