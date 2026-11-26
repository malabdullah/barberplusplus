# Repository Guidelines

## Native app coordination

Owner instruction updated 2026-11-24: the Barber++ Apps Manager chat is the sole manager
and communication route for the iOS and Android agents. All native assignments,
changes, updates, status reports, blockers and dependency requests go through
the coordinator. iOS and Android must not message each other or the Website
agent directly. Website must route native-related handoffs and requests through
the coordinator. This supersedes earlier direct peer coordination permissions;
it does not expand existing implementation, deployment or release authorization.
A later explicit owner instruction may revise this workflow.

All chats are on host `local`:

- Coordinator: `01a1eef1-012d-7310-98aa-45cb154c1019`.
- iOS: `01a1963b-130e-76c3-9d8e-ba685a06f65a`.
- Android: `01a1df6e-9c21-7713-a7d1-b5abee638884`.
- Website: `01a1920e-481a-7a63-a7ca-8c381dab6ecf`.

Read the coordinator chat's direct human instruction with `read_thread` when
verifying messaging authorization. Preserve this routing in platform-specific
agent instructions and handoffs.

Owner instruction updated 2026-11-15: the coordinator maintains reusable private
credentials and shared context in `.coordination-private/registry.json` at the
project root. This directory is local-only and excluded from Git. Agents request
needed information through the coordinator, which supplies the minimum required
for an authorized task using private files or references. Keep passwords, tokens,
cookies and private data out of chat, command arguments, logs and commits. Preserve
canonical stored credentials; delete temporary handoff copies after use. New
agent requests do not expand their task, environment or release authorization.

Owner-input requests stay between the coordinator and the owner. There is no
automatic timed escalation or external assistant relay. Wait for the owner's
reply; silence is not approval.

## Default development and testing target

Owner instruction updated 2026-10-31: deploy every application, database, or
Edge Function change to the hosted Test environment and verify it there before
reporting the change ready. Test is
https://barber-test.alabdullah-cs.workers.dev, backed only by Supabase project
`qvkucvcjmojjbphlzlks` (`barber-test`). Localhost is no longer the default: do
not start or use the local website or Docker Test runtime unless the owner
explicitly asks for it. Local builds, lint and unit checks remain appropriate.

Preserve the hosted `cloud-test` configuration, access gate, private test inbox,
synthetic data and separation from production. Never substitute production
credentials/data or promote to production as part of a Test deployment.
Documentation-only changes need no rebuild of an unchanged application. This
instruction overrides older local-Test defaults in documentation and skills.
The maintained cloud setup is in `docs/cloud-test.md` on
`codex/cloudflare-supabase-test`; reconcile its deployment support before
deploying from another branch.

## Native iOS compatibility scope

Owner instruction updated 2026-11-02: future device compatibility checks default
to **iPhone Duo, iPhone 17 Pro, and iPhone 16e only**. Check the relevant supported
orientations and Duo fold states on these devices. Expand to other phone or
tablet profiles only when the owner explicitly requests it. Use isolated QA
simulators for session-resetting tests and preserve owner accounts/preferences.

## Project Structure & Module Organization

Barber++ is a React 18/Vite application backed by Supabase. Application code lives in `src/`: route-level screens are in `pages/` (including role-specific `admin/`, `agent/`, and `barber/` folders), reusable UI is in `components/`, and Supabase queries belong in `services/`. Shared state, hooks, helpers, constants, translations, and global styles live in their matching directories. Keep database migrations in `supabase/migrations/` and Deno Edge Functions in `supabase/functions/`. Static assets and hosting headers belong in `public/`.

## Build, Test, and Development Commands

Use the scripts in the active checkout's `package.json`; older checkouts may have
retired commands. Maintained main commands include:

- `npm ci` installs locked dependencies; use the pinned Node version in CI.
- `npm run build` builds the frontend; `npm run check` runs maintained lint,
  Functions, application, operational, migration/domain checks and the build.
- `npm run build:cloud-test` prepares hosted Test frontend assets.
- `npm run test:e2e:cloud` runs hosted Test browser checks with the correct private configuration.
- `npm run check:schema` checks database schema drift; inspect its target first.
- `npm run test:production-image` checks the frontend container; exact backend
  image compatibility requires separate evidence against the runtime lock.
- `npm run local:setup`, `local:start`, `local:stop` and `local:reset` are retained
  only for explicitly requested local Test work. Reset destroys owned Test data
  and requires explicit authorization. Do not use retired `local:bootstrap`.

Never commit credentials or copy production credentials into Test. Inspect script
and configuration side effects before execution: a command name is not proof of
its target. Local builds/unit checks do not authorize starting localhost/Docker.

## Coding Style & Naming Conventions

Follow the existing style: two-space indentation, semicolons in JavaScript/JSX, single quotes, and ES modules. Use `PascalCase` for React components and page files, `camelCase` for variables and functions, and `useX` for hooks. Service files use the `entity.service.js` pattern. Keep database fields `snake_case`, converting them to frontend `camelCase` inside the service layer. Put reusable design tokens in `src/styles/index.css`, use shared UI components where possible, and route visible copy through `react-i18next` in both `en.json` and `ar.json`.

## Testing Guidelines

Automated tests exist: Vitest for application units, Deno for Functions,
Node/Python for operational/release safety, pgTAP for database authorization and
Playwright for browser journeys. Run checks appropriate to the change and
`npm run check` before an application PR. Exercise affected roles, supported
layouts, themes and English/Arabic direction. Database changes require migration
replay, schema comparison and permission/denial checks on the correct environment.
Never describe local CLI images as identical to pinned production images.
Documentation-only changes need documentation/diff checks, not an unchanged-app
build, deployment or full regression run.

The full regression campaign is **explicit-only**. Use the personal
`$full-regression-testing` skill and `docs/testing/full-regression.md` only when
the owner requests the full run. Plan creation, ordinary fixes, commits, pushes,
PRs, schedules and successful CI do not trigger it. Existing focused CI remains
unchanged. Store version-bound, redacted results in `docs/testing/runs/` with
PASS/FAIL/BLOCKED/NOT RUN/NOT APPLICABLE per case and variant. Verify run-owned
fixture cleanup; never reset shared Test or use owner accounts as disposable
fixtures. A plan file is not evidence that its scenarios passed.

## Delivery, releases and recovery

Use the reusable `$project-delivery-workflow` when establishing/following the
project delivery process, while preserving Barber++-specific runbooks and owner
authorization. A requested fix normally includes focused implementation, checks,
commit/push, PR preparation and hosted Test verification; report blockers honestly.

`dev` is the development branch; `main` triggers the coordinated production
release workflow. Use `codex/` feature/documentation branches and protect unrelated
work. Inspect push/merge triggers before acting. Production release requires
explicit owner authorization or an already applicable approved release policy;
a request for Test work or documentation does not grant production authorization.
Never merge into main merely to save documentation on GitHub.

Read `docs/deployment-runbook.md`, `docs/environments.md` and `docs/cloud-test.md`.
Keep PR/CI protection, exact commit/artifact identity, ordered migrations and
attestation verification. New tables, RLS/routines, backfills, destructive or
incompatible migrations and platform upgrades require separately reviewed release
handling. Do not edit applied migrations or replay baseline CREATE statements on
an existing production database. A pushed commit, green CI or merged PR alone
is not deployment verification. Report actual Test/production runtime identity.

Production uses Dokploy frontend hosting and a separate self-hosted Supabase
backend; hosted Test uses the isolated Cloudflare/Supabase setup. No permanent
staging or semantic-version-tag promotion is required. Do not resurrect retired
staging instructions from older checkouts or documentation.

Current backup policy is the nightly encrypted off-host Backblaze cycle at
03:15 Kuwait, including isolated restoration verification. It accepts up to about
24 hours of data loss when daily cycles succeed; failures increase the window.
The release gate's 26-hour evidence allowance is not a 26-hour recovery guarantee.
Verify the original successful receipt rather than inferring health from a timer.
The older 15-minute continuous-protection target is retired. See
`docs/backup-restore.md` for the maintained policy and key custody requirements.

Application/Functions rollback preserves current customer writes and uses
compatible prior artifacts. It does not automatically reverse SQL, repair already
damaged data or restore an old database. Database disaster recovery requires
separate reviewed authorization, a recovery point and a reconciliation plan.
Production smoke checks are read-only unless specific disposable mutations are
authorized. Keep credentials, customer records and raw session evidence private.

## Maintaining project documentation

`PRD.md` is the dated product/status inventory; this file defines working rules.
Update relevant documentation with delivered changes. Distinguish production
verification, Test-only implementations, planned/deferred work and retired
features. Code on main, a historic preparation document or an approval alone does
not prove a feature is live. Use release receipts and actual deployment evidence;
keep uncertainty and real-provider testing gaps explicit. Never infer native
activation or app-store publication from a website/backend release.

## Commit & Pull Request Guidelines

History uses concise, imperative, category-prefixed subjects such as `Fix: ...`, `Feature: ...`, `Refactor: ...`, `Security: ...`, and `Docs: ...`. Keep commits focused. PRs should explain the user-visible change, list validation performed, link related issues, and include screenshots for UI changes. Call out migrations, new environment variables, security implications, and deployment steps explicitly.

## Customer terminology

Use **shop** (صالون) in customer and other non-admin interface wording. Reserve
**branch** (فرع) for admin-facing wording. Keep database/API identifiers unchanged.
