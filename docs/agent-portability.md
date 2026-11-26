# Moving the workflow to another agent or machine

The repository is the durable instruction source. Chat memory, personal skill
folders, local worktree paths and proprietary tool names are conveniences, not
requirements for understanding Barber++. Start with [handoff](handoff.md).

## Portable workflow copies

The owner-created skills are versioned here, copied intact from the personal
installation during the 26 November 2026 handoff preparation:

| Workflow | Repository entry point | Supporting resources |
|---|---|---|
| Project delivery | [SKILL.md](agent-skills/project-delivery-workflow/SKILL.md) | UI metadata in its `agents/` directory |
| Full regression testing | [SKILL.md](agent-skills/full-regression-testing/SKILL.md) | Plan/report templates in its `assets/`; explicit-only UI policy |

These are instructions/templates, not an installed test framework or deployment
service. Read the SKILL.md directly in any capable agent. The full regression
workflow runs only on an explicit owner request, even if another tool ignores
Codex's `allow_implicit_invocation: false` setting. Merely copying skills never
starts tests, provisions services or grants production permission.

For an agent with a supported skill system, install copies using that system's
current documented personal/repository skill location. Preserve relative assets,
metadata and invocation policy; verify discovery in the destination. Do not assume
this machine's `~/.codex/skills` exists elsewhere. These `docs/agent-skills` copies
are not automatically installed. For an agent without skills, add explicit links
to these instructions in its project configuration and confirm that it reads them.

Keep repository and personal versions synchronized deliberately: review changes,
retain the explicit-only regression rule and validate referenced files. Do not
silently overwrite a user's existing personal skill or copy a modified skill into
unrelated projects without the requested scope. Native repositories should link
this source or a pinned reviewed copy, not diverge on shared delivery rules.

## Translate capabilities, preserve authority

| Existing capability | Equivalent on another platform |
|---|---|
| Read repository files and Git status | Read the checked-out files, commit identities and local changes with the destination's filesystem/Git tools |
| GitHub PR/check/branch operations | Approved GitHub connector or CLI using the owner's scoped access |
| Hosted browser/API testing | Destination browser/API tools targeting the approved Test identity and synthetic fixtures |
| Codex skill invocation | Explicitly read/apply the corresponding repository instruction file |
| Apps Manager chats and thread references | Owner-designated coordinator and communication channel with recorded assignments/approvals |
| Local private registry and receipts | Owner-approved encrypted private context store; only task-scoped references/copies supplied |

Do not simulate unavailable tools, fabricate test results or claim a message was
sent. Missing tools/access are dependencies, not permission to use production,
contact platform agents directly, bypass required checks or weaken security.
If switching platforms, the owner must establish the equivalent coordinator route;
old Codex chat IDs cannot be assumed usable in a different application.

## Migration sequence

1. Record the current source/remotes, dirty work and active tasks without altering
   them. Obtain the coordinator's private workspace manifest and current holds.
2. Give the destination access to the required repositories/documents. Confirm its
   authorization and keep the native repos private.
3. Have it complete the handoff cold-start questions using only documents/source.
   Resolve documentation gaps before assigning implementation.
4. Identify the minimum external systems needed for its first authorized task.
   Use the private transfer checklist; do not copy all credentials/browser sessions.
5. Separately approve and perform secure access transfer, verifying role/scope,
   environment, expiry, signing/backup-key custody and original credential retention.
6. Verify safe read-only access in the destination. Test builds, provider flows,
   production writes and restoration drills need their own task authorization.
7. Record task ownership and revoke temporary handoff copies under the agreed plan.
   Preserve existing accounts, preferences, source history and customer data.

No migration has occurred merely because these documents are complete. Destination
access checks remain pending until an actual destination and scope are chosen.
