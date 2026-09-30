# Staging owner approval policy

State verified 2026-09-28. This is a policy/configuration change, not release
approval, a merge, or a deployment.

The owner requested a solo-maintainer staging process, retaining pull requests,
all required tests/security scans, a separate code-review pass, and explicit
owner approval before each staging deployment. An AI review must not be
described as an independent human review.

## Applied and verified

GitHub repository: `malabdullah/barberplusplus`.

- Environment `staging`: sole required reviewer is `malabdullah`, user ID
  `19295903`.
- `prevent_self_review: false`: the owner may approve a run they triggered.
- Only protected branches may deploy (`protected_branches: true`,
  `custom_branch_policies: false`).
- No deployment was triggered or approved while configuring the gate.
- Main retains its required-PR object with zero required second-person
  approvals and latest-push approval disabled. All five app-bound checks,
  strict/up-to-date checks, administrator enforcement, stale-review dismissal,
  conversation resolution, and blocked force pushes/deletion remain unchanged.

## Explicit shared-main authorization

The initial combined change was stopped by the safety approval review before
execution. The owner was informed that removing reviews from `main` affects
the shared source branch for both staging and future production. The owner then
explicitly approved: "Approve the shared-main solo-owner policy".

After verifying the new staging owner-approval gate, only
`required_approving_review_count` was patched to zero and
`require_last_push_approval` to false. A full before/after comparison of the
branch protection response verified every other field unchanged. The staging
skill and runbooks are aligned with that policy. A separate recorded code review
is still required, but must not be represented as independent human review.
Do not infer permission to merge or deploy from policy-change approval.

## Production is separate and not ready

Read-only inspection found only a `staging` GitHub environment and no repository
rulesets. Do not claim that production environment approval or tag protection
has been configured. Production workflow/code, secrets and resources were not
changed. A separately approved production setup must establish and verify its
release/tag restrictions and independent environment approval before release.

## Recovery

The original main review settings were one approving review and latest-push
approval required. Keep the new staging owner approval gate in place unless a
separately authorized policy change replaces it. Restore those original main
settings if a later approved policy change deliberately reverses solo-owner mode.
