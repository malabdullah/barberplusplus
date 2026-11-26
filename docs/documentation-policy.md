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

Workflow installation and required-check activation are separate operations.
Introduce these files through a reviewed documentation-only PR, verify both a
missing-declaration failure and a corrected-declaration success on GitHub, then
require `documentation-review` from GitHub Actions (app ID 15368). Record the PR,
commit and branch-rule read-back as activation evidence. A branch containing this
workflow alone is not proof of enforcement.

Preserve main's existing `application`, `browser`, `database`, `dependency-review`
and `secret-scan` requirements, strict/up-to-date behavior and other controls.
Re-read settings immediately before updating and preserve concurrent changes.
Require the documentation check for dev integration as well; preserve any existing
rules. Verify a PR with a missing declaration reports a failed required check,
then edit its body and observe a successful result. Close disposable verification
PRs without merging their fixture content.

Owner instruction on 26 November authorizes documentation activation without
any deployment or full regression. Main normally triggers production delivery.
For this documentation-only installation, verify the exact file allowlist,
coordinate the merge window, temporarily disable production-triggering workflows
only for the merge, and use `[skip ci]` on the final merge commit to suppress
push-triggered release runs. Keep normal required pre-merge PR checks intact.
Restore each workflow to its original state afterward and verify no release
artifacts or production workflow run were created for that merge. Do not use this
procedure for application, database, dependency or deployment changes. It does
not authorize deploying a documentation-only commit or a blanket future bypass.

A passing declaration still requires human review. Where a PR changes the checker
or its workflow, reviewers must inspect the policy implementation itself. Do not
weaken branch protections or falsify check results to install the gate.

Local focused verification:

```sh
python3 -m unittest discover -s .github/scripts -p 'test_documentation_review.py'
```

To exercise the CLI without GitHub, supply a synthetic PR event JSON through
GITHUB_EVENT_PATH with immutable base/head SHAs and a body using the fields above.
The checker reads Git's merge-base diff and fails closed if input/diff is missing.
It does not call GitHub or start any application runtime.

## Handoff continuity

Review [the start guide](handoff.md), [state snapshot](handoff-state.md),
[architecture](architecture.md) and [index](README.md) when ownership, workflow,
contracts, environments or release/hold state changes. Preserve historical
observations with clear notices; do not turn them into current deployment claims.
Keep sensitive inventories/transfer acceptance in the private coordination area.

The same documentation check also runs `scripts/verify-handoff-docs.py` and its
focused tests. They validate maintained local links/anchors, historical-notice
links and portable skill hashes/explicit-only policy. They do not certify private
repository access, provider behavior, credentials, runtime health or a real
machine migration. Owner approval and actual destination-specific access checks
are separate from documentation readiness.
