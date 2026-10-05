# Production Readiness Snapshot — 2026-09-02

Checked at: `2026-09-02T11:00:37Z`

Decision: **NO-GO — preparation only; no production action authorized**

This snapshot contains no production secrets and does not claim that external
systems were inspected. Evidence must be refreshed for the specific release.

## Candidate state

| Item | Observed state | Gate |
| --- | --- | --- |
| Worktree | Detached at `9ce91251f0c6a9732c22a7095260f13804674a7c`; 68 changed/untracked/deleted paths | FAIL — not a clean, reviewed release commit |
| Semantic release tag | No `v*` tag observed | FAIL |
| Staging acceptance manifest | No local or supplied accepted-release artifact, digest, migration, run ID, or acceptance time | FAIL |
| Explicit production approval | No approval naming a tag and digest | FAIL |
| Protected production approval | Cannot exist before a candidate tag workflow is pending | FAIL |
| Authoritative baseline | `supabase/.baseline-ready` and `supabase/schema.expected.sql` absent | FAIL |
| Migration naming | Eight incomplete legacy files fail `npm run check:migrations` | FAIL |
| Migration compatibility | Unrehearsed production-specific cron migration precedes its replacement; trusted-role/RLS switch requires proven session-refresh compatibility | FAIL |
| Backup/WAL/object evidence | No authenticated freshness response supplied | FAIL |
| Restore evidence | No isolated restore-drill record supplied | FAIL |
| Monitoring | No external probe/alert evidence or acknowledged observation owner supplied | FAIL |
| Rollback | No current production frontend reference or production Function-bundle rollback evidence supplied | FAIL |
| Cleanup | Observation has not started; no cleanup inventory or separate approval exists | NOT ELIGIBLE |
| `dev` branch | Two commits are absent from `main`; `dev` and a related branch are active in other worktrees | PRESERVE — deletion forbidden |

## Repository-controlled validation

| Check | Result |
| --- | --- |
| `git diff --check` | PASS |
| Production/staging workflow YAML parse | PASS |
| Backup-readiness valid fixture | PASS |
| Backup-readiness stale fixture | PASS (correctly rejected) |
| Pinned Supabase CLI discovery (`2.67.1`) | PASS |
| `npm run lint` | PASS |
| `npm run test` | PASS — 6 tests |
| `npm run build` | PASS — bundle-size warnings remain |
| `npm run lint:functions` | PASS |
| `npm run check:functions` | PASS |
| `npm run test:functions` | PASS — 3 tests |
| `npm run test:e2e` | PASS — 1 public landing-page journey |
| `npm run check:domains` | PASS |
| `npm run check:migrations` | FAIL — authoritative baseline work is incomplete |
| Clean database replay, pgTAP, schema drift | NOT RUN — deliberately gated by the missing authoritative baseline |

Local Node was `24.9.0`, below the repository's required `24.20.0`; GitHub CI is
configured for `24.20.0`. The successful local checks do not replace a clean CI
run on the final commit.

## Controls prepared in this snapshot

- Production now downloads the successful accepted staging manifest for the
  exact release commit, compares its digest and migration to the registry and
  source, and promotes that digest without rebuilding.
- Production now requires a tag-specific `docs/releases/vX.Y.Z.md` record with
  reviewed staging and migration-compatibility decisions before it can reach
  the protected environment approval.
- Backup readiness now has a strict machine-readable contract covering evidence
  age, 15-minute recoverable point/WAL lag, off-site base and object backups,
  and a recent restore drill meeting the 15-minute RPO and two-hour RTO.
- `docs/releases/template.md` records exact preparation/tag commands, a timed
  runbook, smoke checks, rollback, observation timestamps, cleanup inventory,
  separate cleanup approval, and safe branch-deletion checks.

## Required next evidence

1. Complete and approve the authoritative baseline, migration-history repair
   rehearsal, clean replay, pgTAP, and schema drift proof.
2. Replace or consolidate the legacy cron migration sequence and rehearse the
   trusted-role/session transition on an isolated production restore.
3. Commit the reviewed work on `main`, obtain clean CI, deploy staging, and
   complete role, integration, security, and restore acceptance.
4. Copy the release template to the chosen `vX.Y.Z.md`, fill the exact commit,
   digest, migration, owners, rollback target, monitoring, and fresh backup
   evidence, then commit and re-accept that exact commit in staging.
5. Ask the user for explicit approval naming that exact tag and digest. Only
   then create/push the annotated tag and approve its protected production job.

No 72-hour observation clock can start until production smoke checks pass and a
UTC GO time is recorded. No live or branch cleanup can begin until 72 healthy
hours subsequently elapse and the user separately approves the exact inventory.
