# Deployment Runbook

## One-time GitHub and hosting setup

Protect `main` with pull-request review and all CI jobs. Stop using `dev` as an
environment branch only after comparing it with `main` and preserving every
unique commit and working-tree change. Protect `v*` tags and configure GitHub
environments named `staging` and `production`; production requires an approver.

Register the dedicated Mac runner only to this repository and label it
`barber-staging`. Install it as a launch service outside Documents. Configure
the `staging` environment with its two public URL variables and Cloudflare
Access secrets. Production retains its separate Dokploy application and API
credential. Configure runtime values from `docs/environments.md`.

The local staging workflow directly manages the isolated Docker stack. The
production Supabase host must expose a narrowly scoped authenticated deploy hook
that:

1. checks out the requested commit from this repository;
2. refuses commits not reachable from `main`;
3. installs locked dependencies;
4. atomically replaces the Edge Function bundle;
5. restarts only the Edge Runtime; and
6. health-checks functions and rolls back the bundle on failure.

The hook secret is environment-specific. It must never accept arbitrary shell
commands or repository URLs.

## Staging release

A successful CI run on `main` builds one image tagged by commit SHA on a
GitHub-hosted runner and pushes it to GHCR. The dedicated Mac runner backs up the
local database and Storage, applies local migrations, starts Edge Functions as a
persistent launch service, and deploys the frontend by immutable digest. It
retains the previous frontend until smoke, security-boundary, and Playwright
checks pass. The accepted manifest records the complete migration set. Migration
pushes use `--skip-vault`; secrets are never changed as a schema side effect.

Do not merge to `main` when its required pull-request and CI protection rules
are unavailable. A private GitHub Free repository does not satisfy this gate.

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

For staging, a failed acceptance run invokes
`scripts/rollback-local-staging-frontend.sh` to restore the retained container.
Do not reverse a destructive migration; restore the protected local backup or
apply a reviewed forward fix. Edge Function failures must be corrected and the
accepted commit redeployed.

The production workflow captures the previous Dokploy image reference before
every deployment and retains it as a protected artifact. For an application
rollback, redeploy that digest with `scripts/dokploy-deploy.sh`; target completion
is 15 minutes. The first cutover must record the final legacy release separately
because it is not an OCI digest. Do not reverse a destructive migration. Use forward remediation
or the rehearsed restore procedure. Record the incident, affected release,
database migration version, decision maker, and verification evidence.
