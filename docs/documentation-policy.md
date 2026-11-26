# PR documentation maintenance

Every PR records its documentation impact using
`.github/pull_request_template.md`. The `Documentation review` workflow runs the
`documentation-review` check on PR creation, body edits, commits, reopening and
readiness changes. It has read-only repository permissions, no persisted Git
credentials, no deployment job, no network dependency installation and no app,
database or full-regression test execution. PR text is parsed as data.

## Author and reviewer responsibilities

- Update PRD.md when features, business rules, permissions or environment/release
  status change. Keep production, Test-only, planned and retired distinct.
- Update AGENTS.md when working instructions change. Ordinary implementation
  changes need not alter it; provide a specific unchanged explanation.
- Provide both document decisions and reasons in the exact template fields.
  Remove the SELECT/REPLACE placeholders. An `updated` declaration needs the
  corresponding changed file in the PR; `unchanged` must match the diff.
- Feature status other than `unchanged` requires PRD.md to change. If several
  features differ, summarize their individual states in PRD.md and the reason.
  `production` additionally requires a verified release-evidence reference.
- Review documentation against the final code. File changes and an explanatory
  sentence do not prove semantic completeness, deployment or truthful evidence.
  Reviewers must check those, especially changes to the checker/workflow itself.
- Before delivery, document the implementation's actual Test/planned status.
  Promote to production status only after runtime verification, using a follow-up
  documentation PR if necessary. A PR/merge/CI pass is not production evidence.
- Keep native PRDs in their own repositories. Apps Manager owns routing the
  iOS/Android updates and their shared-contract reconciliation; website agents
  do not bypass that coordinator or overwrite native working instructions.

Example for a documentation-policy update without a product change:

```text
## Documentation review
PRD: unchanged
PRD reason: No customer behavior, business rule or release status changes.
AGENTS: updated
AGENTS reason: Added the PR documentation declaration and review requirements.
Feature status: unchanged
Release evidence: not applicable
```

## Activation and required-check enforcement

This branch prepares the workflow; pushing it does not activate enforcement on
main/dev. The owner requested commit/push only, with no merge or deployment.
Do not merge into main to install this gate without release authorization: main
starts the production workflow even for a documentation change.

After an authorized workflow introduction, run the check on an actual PR and
verify both a missing declaration failure and a valid declaration success. Add
`documentation-review` from GitHub Actions (app ID 15368) to main's required
checks, preserving existing `application`, `browser`, `database`,
`dependency-review`, `secret-scan`, strict/up-to-date behavior and other controls.
Re-read current settings immediately before updating; do not overwrite concurrent
requirements or remove protections. Confirm the read-back and an actual blocked
merge state. GitHub requires a recent check result to select a new required check.

Inspection on 26 November 2026 found main protected with those five checks and
dev unprotected. Do not claim this new check blocks merges until the branch rule
is updated and verified. Dev protection is a separate repository-policy decision;
the workflow still reports on dev PRs after introduction but reporting alone does
not prevent direct pushes or merges. No protection settings were changed merely
by preparing these files.

Local focused verification:

```sh
python3 -m unittest discover -s .github/scripts -p 'test_documentation_review.py'
```

To exercise the CLI without GitHub, supply a synthetic PR event JSON through
GITHUB_EVENT_PATH with immutable base/head SHAs and a body using the fields above.
The checker reads Git's merge-base diff and fails closed if input/diff is missing.
It does not call GitHub or start any application runtime.
