# Barber++ maintainer and agent handoff

Start here when replacing a maintainer, moving to another coding agent, or moving
machines. This is a documentation intake procedure, not permission to deploy,
reset data, test real customer flows, change credentials or publish native apps.
Read the dated [state snapshot](handoff-state.md) before relying on a version.

## 1. Read in this order

1. Root [AGENTS.md](../AGENTS.md): owner instructions, native coordination,
   private access, supported devices, Test target and authorization boundaries.
2. Root [PRD.md](../PRD.md): roles, requirements, production/Test/planned/retired
   inventory and evidence definitions. It is not a live monitoring endpoint.
3. [State and unfinished work](handoff-state.md): snapshot and how to refresh it.
4. [Architecture/contract map](architecture.md): module ownership, data boundaries
   and pointers to shared API contracts; inspect the source matching the target.
5. [Environments](environments.md), [Cloud Test](cloud-test.md),
   [release runbook](deployment-runbook.md), [backups/recovery](backup-restore.md).
6. [Documentation index](README.md): distinguish maintained instructions,
   versioned feature contracts, historical evidence and deferred work.
7. [Documentation policy](documentation-policy.md),
   [agent portability](agent-portability.md), and the applicable native handoff.

If two instructions conflict, follow the latest direct owner instruction and
applicable AGENTS.md. Use current runbooks for operations, dated verification for
what was observed, and target-version code for actual behavior. A historic feature
record's Test-only/pending wording never overrules a later verified release.
Stop dependent work and resolve a genuine contradiction with the owner/coordinator;
continue independent safe work. Silence is not approval.

## 2. Repositories and ownership

| Repository | Scope | Start documents |
|---|---|---|
| [barberplusplus](https://github.com/malabdullah/barberplusplus) | Website, shared backend, migrations, hosted Test, production release tooling | This guide, root AGENTS/PRD, architecture map |
| [barberplusplus-ios](https://github.com/malabdullah/barberplusplus-ios) | Native SwiftUI customer app; private repository | [Platform handoff](https://github.com/malabdullah/barberplusplus-ios/blob/main/docs/handoff.md), root AGENTS/PRD and design/API documents |
| [barberplusplus-android](https://github.com/malabdullah/barberplusplus-android) | Native Kotlin/Compose customer app; private repository | [Platform handoff](https://github.com/malabdullah/barberplusplus-android/blob/main/docs/handoff.md), root AGENTS/PRD and parity/backend documents |

Native assignments, status, blockers and Website dependencies go through Apps
Manager only. The coordinator/chat references are in AGENTS.md. Do not message
platform agents directly, impersonate another agent, infer their release scope
or edit a native repository from website work. If moving outside Codex, the owner
must designate an equivalent coordination channel and responsible people first.

Local nested `iOS/` and `Android/` directories are independent repositories, not
permission to add native code to the website index. Paths, worktrees and chat IDs
are local conveniences; Git repositories and reviewed records carry the durable
knowledge. Do not initialize or overwrite repositories without checking boundaries.

## 3. Safe intake and current-state verification

Before touching code, record your assigned task, allowed environments and actions.
Use read-only inspection first:

```sh
git status --short
git branch --show-current
git log -1 --oneline
git remote -v
git worktree list
```

Inspect remotes privately: a misconfigured remote could contain a credential.
Do not paste raw outputs containing private URLs, account data or secrets into
chat or Git. Fetch through approved credentials when needed; do not pull/reset/
clean over unrelated work, prune worktrees or discard uncommitted files.

- Compare local HEAD and remote main/dev; choose an isolated feature worktree.
  The parent directory can be an old checkout even when another worktree is current.
- Read the public production `runtime-config.js` at the approved website origin;
  record only environment, app origin and release. Compare its commit with the
  matching Git source and the accepted image/release record. Never print the
  whole configuration or assume latest main is the running application.
- Read hosted Test runtime identity through its approved access gate. Confirm the
  project is `qvkucvcjmojjbphlzlks`; compare frontend, backend and migration identity.
  Different Test feature branches/overlays may coexist. Do not redeploy to make
  them match your checkout merely to complete onboarding.
- Ask Apps Manager for native source/build/channel/status and active holds.
  Public, submitted, staged, internal Test and locally built mean different things.
- Check CI/workflow triggers, required checks and branch rules before any push or
  merge. A main merge can create a production release; a doc-only commit is not
  automatically deployment-free.
- Ask the coordinator for the current private workspace/unfinished-work manifest
  and release receipts. Local presence, a historical PR or an open branch is not
  proof that unfinished work should be resumed, deleted or promoted.

A read-only onboarding pass ends with an evidence-backed summary and remaining
access dependencies. It does not start localhost, Docker, provider prompts,
notifications, production smoke writes, deployment or full regression.

## 4. Access and machine migration

Public documentation contains no reusable credentials. Apps Manager maintains the
local-only `.coordination-private/registry.json` under the owner workspace. Request
only the minimum references/temporary handoff needed for the authorized task.
Do not independently read/export the whole registry, Keychain, Vault, session store,
backup archives, signing identities or private logs. Delete temporary credential
copies after use and preserve canonical stored credentials.

The local-only `handoff-transfer-checklist.md` and
`handoff-workspace-manifest.json` in that private coordination area describe
custodians, categories and workspace metadata. They are not bundled in this public
repository. If the old machine is unavailable, the owner/coordinator must provide
its approved independent access/recovery route; the repository cannot recreate keys.

Before an actual move, agree destination identity, authorized systems, secure
transport/storage, recovery-key custody, expiry/revocation and acceptance with the
owner. Transfer references or narrowly scoped secrets through approved private
means, never public Git or chat. Preserve encrypted backup recovery access and
native signing/provider ownership. A documentation handoff is not evidence that
credentials have been transferred or a disaster restore has been rehearsed.

## 5. Normal work and testing

Use the pinned Node version and locked dependencies in the selected checkout.
Read package scripts and target configuration before running them. Local build,
lint and unit checks are allowed for relevant implementation; app/database/Function
changes must be deployed to hosted Test and verified there before readiness.
Starting localhost/Docker requires the owner's explicit instruction. Existing CI
may use isolated synthetic runners; that does not authorize resetting shared Test.

Commit focused changes, push a feature branch, prepare a PR, verify required CI
and report exact deployment/check evidence. Keep production separate. Use the
portable [delivery workflow](agent-skills/project-delivery-workflow/SKILL.md)
if no personal skill installation exists.

The [full regression plan](testing/full-regression.md) is a separate explicit-only
campaign. Its creation, the word “handoff”, a PR or a request to fix a feature does
not trigger it. Use the portable
[regression instructions](agent-skills/full-regression-testing/SKILL.md) only when
explicitly asked to prepare/update or run that workflow; preparation is not a run.

## 6. Release and recovery guardrails

Read the current release runbook; do not copy commands from historical candidate
records. Preserve protected PR/CI, attested commit/image/backend identities and
ordered migration hashes. Production baseline adoption and component upgrades
are separately reviewed operations, not routine development setup.

Keep current customer writes during compatible frontend/Functions rollback.
Database restoration is separately authorized and can discard bookings/edits after
the recovery point. Nightly backup policy is not proof of today's success; inspect
the original restore/freshness receipt. The recorded nightly policy accepts up to
about 24 hours of changes when cycles succeed, more after failures.

No native build, backend credential, payment pilot or store publication is enabled
by reading or transferring these documents. The separate native private-repository
plan limitation means its documentation checks run but cannot currently be enforced
as mandatory protected-branch checks. Respect failures manually until that changes.

## 7. Cold-start acceptance

The receiving agent must be able to identify, with document/source references:

- The three repositories, their roles and the sole native coordination route.
- Hosted Test versus production, the actual running version versus Git HEAD,
  and the separate native build/review/publication states.
- Where customer/work authorization and booking consistency are enforced.
- Relevant service/Function/schema contract ownership, migration history and
  the appropriate test commands without starting an unauthorized runtime.
- PR requirements, production triggers, backup evidence, recovery limits and
  why application rollback preserves the current database.
- Current held/Test-only work, the owner of each active task and what access is
  missing. Do not invent permissions or credentials to fill a gap.
- Where the portable skills and explicit-only full regression rules live.
- How to obtain private access safely without exporting it into the repository.

If any answer depends only on chat memory, add the missing nonsecret information
to the appropriate maintained document, or its private counterpart for sensitive
context. Record the receiving agent's gaps honestly. Actual access acceptance and
runtime testing remain distinct from documentation readiness.

Maintain this guide and the state snapshot when workflow, architecture, ownership,
environment or release/hold status changes. Review its links in every relevant PR.
