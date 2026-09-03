# Deployment Runbook

## One-time GitHub and Dokploy setup

Protect `main` with pull-request review and all CI jobs. Stop using `dev` as an
environment branch only after comparing it with `main` and preserving every
unique commit and working-tree change. Protect `v*` tags and configure GitHub
environments named `staging` and `production`; production requires an approver.

Create separate Dokploy applications and API credentials for staging and
production. Configure their runtime values from `docs/environments.md`. Add the
workflow secrets referenced in `.github/workflows/deploy-staging.yml` and
`.github/workflows/deploy-production.yml`. GHCR pull tokens should be read-only.

Each Supabase host must expose a narrowly scoped authenticated deploy hook that:

1. checks out the requested commit from this repository;
2. refuses commits not reachable from `main`;
3. installs locked dependencies;
4. atomically replaces the Edge Function bundle;
5. restarts only the Edge Runtime; and
6. health-checks functions and rolls back the bundle on failure.

The hook secret is environment-specific. It must never accept arbitrary shell
commands or repository URLs.

## Staging release

A successful CI run on `main` builds one image tagged by commit SHA, pushes it to
GHCR, applies migrations, deploys Edge Functions, and tells Dokploy to deploy the
image by immutable digest. Smoke checks verify runtime environment/release and
security headers. The accepted commit/digest manifest records a deterministic
hash of every active migration and is retained as an artifact. Migration pushes
use `--skip-vault`; secrets are managed separately and are never changed as an
implicit side effect of schema deployment.

## Production promotion

1. Confirm staging E2E/security tests, restore rehearsal, and at least 72 hours
   for a Supabase component upgrade.
2. Create an annotated semantic tag on the accepted commit:
   `git tag -a vX.Y.Z <commit> -m "Release vX.Y.Z"`.
3. Push the tag. The protected production environment pauses for approval.
4. The workflow verifies the exact commit is still running in staging, confirms
   the complete migration set still matches the staging artifact, confirms
   backup freshness, runs a non-mutating migration dry run, applies reviewed
   compatible migrations/functions, and promotes the existing GHCR digest
   without rebuilding.
5. Complete non-destructive admin, manager, agent, and barber smoke journeys.

## Rollback

The production workflow captures the previous Dokploy image reference before
every deployment and retains it as a protected artifact. For an application
rollback, redeploy that digest with `scripts/dokploy-deploy.sh`; target completion
is 15 minutes. The first cutover must record the final legacy release separately
because it is not an OCI digest. Do not reverse a destructive migration. Use forward remediation
or the rehearsed restore procedure. Record the incident, affected release,
database migration version, decision maker, and verification evidence.
