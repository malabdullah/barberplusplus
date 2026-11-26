## Change

Describe the problem and resulting behavior.

## Validation

List focused checks and hosted Test evidence, or explain why they do not apply.
Do not run the explicit-only full regression campaign unless requested.

## Documentation review

Review the handoff/state snapshot, architecture and contract pointers when affected,
as well as PRD.md and AGENTS.md. Historical phase evidence must stay clearly marked.

Replace every placeholder below. Keep these field names; the documentation check
validates them. Use `updated` or `unchanged` for each document.

PRD: SELECT updated OR unchanged
PRD reason: REPLACE with affected requirements/status sections, or why none change.
AGENTS: SELECT updated OR unchanged
AGENTS reason: REPLACE with changed working rules, or why existing rules still apply.
Feature status: SELECT unchanged OR production OR test-only OR planned OR retired
Release evidence: REPLACE with verified release evidence if status is production; otherwise not applicable.

For a feature/status change, update PRD.md in this PR. For working-rule changes,
update AGENTS.md. A merge, approval or successful build alone is not production
release evidence. Never include credentials or private customer records.
