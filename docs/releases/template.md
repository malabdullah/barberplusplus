# Barber++ Production Release `vX.Y.Z`

Status: DRAFT — NOT AUTHORIZED FOR PRODUCTION

## Immutable release identity

| Field | Required value / evidence |
| --- | --- |
| Tag | `vX.Y.Z` (annotated; not created until every pre-tag gate passes) |
| Commit | Recorded from the successful staging artifact before approval |
| Accepted GHCR digest | Recorded from the successful staging artifact before approval |
| Accepted migration set | Tree digest and file hashes from that artifact |
| Staging workflow run | Recorded from the successful staging artifact before approval |
| Staging acceptance time | Recorded from the successful staging artifact before approval |
| Production URL | Public production origin |
| Release coordinator | Named person |
| Production approver | Repository owner |
| Launch window | Start/end in UTC and Asia/Kuwait |
| Communication channel | Named channel; no secrets |

Release preparation decision: BLOCKED

Migration compatibility decision: BLOCKED

## Gate evidence

| Gate | Required evidence | Decision / owner / UTC time |
| --- | --- | --- |
| CI and staging | CI, role E2E, security, runtime release, and header checks passed on the exact commit | BLOCKED |
| Image identity | Manifest digest matches the commit-tagged registry manifest and running staging release | BLOCKED |
| Schema baseline | `supabase/.baseline-ready`, clean replay, pgTAP, schema drift, and approved production history repair | BLOCKED |
| Migration compatibility | DBA/security review confirms only rehearsed backward-compatible changes; no destructive contract step | BLOCKED |
| Supabase component compatibility | Production/staging image versions recorded; PG major version, API gateway, Studio ownership, Data API grants, and Realtime restrictions reviewed | BLOCKED |
| Production backup | Authenticated evidence checked within 5 minutes; recoverable point and WAL lag <=15 minutes | BLOCKED |
| Base/object backup | Healthy off-site database and Storage backups no older than 25 hours | BLOCKED |
| Restore evidence | Isolated drill <=92 days old; database and Storage restored; RPO <=15 minutes and RTO <=2 hours | BLOCKED |
| Edge Functions | Exact commit deployed successfully to staging; production hook rollback procedure rehearsed | BLOCKED |
| Monitoring | External probes and alert recipients confirmed for frontend, Auth, REST, Realtime, Storage, Functions, DB, cron, email, and WhatsApp | BLOCKED |
| Application rollback | Current production frontend reference recorded and redeploy access tested; target <=15 minutes | BLOCKED |
| Data recovery | Forward-remediation and rehearsed restore decision path named; active DB/Storage preserved | BLOCKED |
| Ownership/access | Least-privilege production, Dokploy, GHCR, DNS/TLS, backup, monitoring, and incident access confirmed | BLOCKED |
| Explicit release approval | User names this tag and digest; protected GitHub `production` environment approval remains mandatory | BLOCKED |

Any BLOCKED or expired evidence means NO-GO. Do not tag, push, dispatch, migrate,
deploy Functions, or change Dokploy.

## Exact preparation commands (read-only until tag creation)

Run from a clean clone or a reviewed clean release worktree. Discover the pinned
CLI syntax before relying on it:

```sh
npx supabase --version
npx supabase db push --help
npx supabase functions --help
git status --short --branch
git fetch --tags origin
git rev-parse <accepted-commit>
git merge-base --is-ancestor <accepted-commit> origin/main
git tag --list 'vX.Y.Z'
git cat-file -e <accepted-commit>^{commit}
```

The workflow runs `db push --dry-run --skip-vault` against production before the
fresh backup gate, retains the preview, and repeats the reviewed push with
`--skip-vault`. Vault and Function secrets are managed through their separate,
audited process.

Retrieve the successful `accepted-release-<commit>` staging artifact without
printing credentials. Record its commit, digest, migration, acceptance time, and
workflow run above. Verify that the registry digest for the commit equals the
artifact digest and that staging still reports the same release.

After this record is complete and committed, deploy that exact commit to staging.
The successful staging artifact supplies the immutable identity fields; attach
them to the approval request without changing the accepted commit. After the
user explicitly approves the exact tag, commit, and digest, create and push the
tag:

```sh
git tag -a vX.Y.Z <accepted-commit> -m "Release vX.Y.Z"
git cat-file -t vX.Y.Z
git rev-list -n 1 vX.Y.Z
git push origin refs/tags/vX.Y.Z
```

Pushing starts the workflow but does not bypass the protected production
environment. Confirm its displayed tag, commit, and digest before approving it.

## Timed production runbook

| Offset | Owner | Action and stop condition | Evidence |
| --- | --- | --- | --- |
| T-30m | Coordinator | Freeze unrelated production/schema changes; open incident channel | UTC time |
| T-25m | Backup owner | Re-run authenticated readiness check; stop on any expired/failed field | Redacted result ID |
| T-20m | Release owner | Confirm tag/commit/staging digest/migration and current production rollback target | Values |
| T-15m | Monitoring owner | Confirm external probes, dashboards, alert routing, and on-call acknowledgement | Links/ack |
| T-10m | DBA | Reconfirm compatible migration plan and production migration baseline | Decision |
| T-5m | Approver | Approve the exact pending GitHub deployment | Actor/time |
| T+0 | Workflow | Apply migrations; stop immediately on failure | Run step |
| T+5m | Workflow | Atomically deploy Functions from the exact commit; stop/rollback bundle on failed health check | Run step |
| T+10m | Workflow | Record previous frontend reference and deploy accepted digest without rebuilding | References |
| T+15m | Workflow | Verify production environment/release and security headers | Output |
| T+20m | Role owners | Run non-destructive admin, manager, agent, and barber journeys; suppress uncontrolled email/WhatsApp | Results |
| T+30m | Coordinator | GO only if smoke checks and monitoring are healthy; otherwise invoke rollback/incident path | Decision |

Do not reverse a destructive migration. Application rollback uses the recorded
previous frontend reference. Function rollback uses the deploy hook's retained
bundle. Database trouble uses forward remediation or the rehearsed isolated
restore procedure, with the RTO clock and decision maker recorded.

## Production verification

| Check | Result / evidence / UTC time |
| --- | --- |
| Frontend serves expected commit and accepted digest | PENDING |
| Required CSP/security/cache headers | PENDING |
| Auth and session refresh behavior | PENDING |
| REST and RLS-safe read journey | PENDING |
| Realtime subscription | PENDING |
| Storage read of an existing authorized object (no mutation) | PENDING |
| Edge Function health and auth rejection paths | PENDING |
| Admin, manager, agent, and barber journeys | PENDING |
| Cron schedule/last success (do not trigger customer communication) | PENDING |
| Email/WhatsApp queues and failures (no uncontrolled send) | PENDING |
| Errors, latency, DB saturation, CPU, memory, disk, TLS, backups | PENDING |

Production decision: DEFERRED

Rollback target retained: UNCONFIRMED

## 72-hour observation record

Set `observation_started_at` only after the production GO decision. Set
`cleanup_eligible_at` to exactly 72 hours later. Paused/unhealthy intervals do
not count as healthy observation time; reset the healthy-window start after a
rollback or material incident.

| Field | UTC value |
| --- | --- |
| `observation_started_at` | NOT STARTED |
| `cleanup_eligible_at` | NOT CALCULATED |
| Current production tag / digest / migration | NOT DEPLOYED |
| Rollback target | NOT RECORDED |
| Observation owner | UNASSIGNED |

Record named checks at +1h, +4h, +12h, +24h, +48h, and +72h covering uptime,
errors, core journeys, transactions/forms, Auth failures, Functions, cron,
email/WhatsApp failures, database capacity, WAL/backups, and certificates.

Observation decision: NOT STARTED

## Separately approved legacy cleanup

Cleanup is forbidden until the recorded window contains 72 healthy elapsed
hours and the user explicitly approves the exact inventory below. The release
approval is not cleanup approval.

| Inventory ID | Exact resource/reference | Replacement and zero-traffic evidence | Backup/recovery | Proposed action | Approval |
| --- | --- | --- | --- | --- | --- |
| | | | | | NOT APPROVED |

Never inventory the active production database, active Storage, or customer data
as cleanup targets. After cleanup approval, remove only listed superseded
frontend resources, obsolete cron/Vault/DNS/webhook/TLS references, and revoke
only listed legacy credentials. Attach zero-reference searches and provider
traffic evidence.

Before deleting `dev`, preserve user work and resolve worktrees/unique commits:

```sh
git status --short --branch
git worktree list --porcelain
git log --oneline origin/main..dev
git log --oneline origin/main..origin/dev
git branch --contains dev
git branch -r --contains origin/dev
```

Only when both unique-commit checks are empty, every related worktree is safely
resolved, the new release path has passed, and cleanup approval explicitly names
the branch:

```sh
git branch -d dev
git push origin --delete dev
```

Cleanup decision: NOT ELIGIBLE / NOT APPROVED
