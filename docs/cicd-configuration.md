# CI/CD Configuration

This document records the required GitHub, GHCR, and Dokploy configuration. It
names credentials but never records their values. Configure staging and
production independently; do not create repository-level deployment secrets.

## Workflow trust boundaries

- `CI` runs for pull requests and pushes to `main` with `contents: read`. It has
  no deployment environment and therefore receives no staging or production
  environment secrets.
- `Deploy staging` runs only after a successful `CI` push run for `main` in this
  repository. A pull-request run, fork run, or non-`main` run cannot enter the
  deployment job.
- `Promote production` runs only for a semantic `vX.Y.Z` tag. Its first job uses
  the `staging` environment to retrieve the accepted digest and smoke the exact
  commit. The second job uses `production`, waits for its approval, and receives
  production secrets only after approval.
- `supabase/.baseline-ready` is an intentional hard gate in both deploy
  workflows. Do not create it until `docs/database-baseline.md` is complete.

## GitHub environments

Create the environments at **Repository settings > Environments**. Enter each
name exactly as shown. Values in the two rows must be different even when a
variable or secret has the same name.

### `staging`

Allow deployments from selected branches and tags: branch `main` and tag `v*`.
The tag allowance is needed only for the production workflow's staging
verification job. Do not add required reviewers to staging unless automatic
main-to-staging deployment is intentionally being paused.

Environment variables:

| Name | Enter at | Meaning |
| --- | --- | --- |
| `APP_URL` | staging environment variable | Public staging frontend origin |
| `FUNCTION_DEPLOY_HOOK` | staging environment variable | Narrow staging Edge Runtime deploy-hook URL |
| `DOKPLOY_URL` | staging environment variable | Dokploy origin, without `/api` |
| `DOKPLOY_APPLICATION_ID` | staging environment variable | Staging frontend application ID |
| `GHCR_PULL_USERNAME` | staging environment variable | GitHub service-account username used only to pull |

Environment secrets:

| Name | Enter at | Minimum capability |
| --- | --- | --- |
| `SUPABASE_DB_URL` | staging environment secret | Direct staging Postgres migration connection; no production access |
| `FUNCTION_DEPLOY_SECRET` | staging environment secret | Authenticate only the staging function deploy hook |
| `DOKPLOY_API_KEY` | staging environment secret | Read/update/deploy only the staging application |
| `GHCR_PULL_TOKEN` | staging environment secret | Classic PAT with `read:packages` only |
| `ACCESS_CLIENT_ID` | staging environment secret | Cloudflare Access service token ID for staging smoke tests |
| `ACCESS_CLIENT_SECRET` | staging environment secret | Matching Cloudflare Access service token secret |

### `production`

Allow deployments only from selected tags matching `v*`. Add at least one
required reviewer, enable **Prevent self-review**, and do not add branch rules.
GitHub makes environment secrets available only after the reviewer approves the
job. If the repository visibility/plan does not support required reviewers for
this environment, production promotion is not ready; change the plan or use an
approved external deployment protection rule before enabling releases.

Environment variables:

| Name | Enter at | Meaning |
| --- | --- | --- |
| `APP_URL` | production environment variable | Public production frontend origin |
| `FUNCTION_DEPLOY_HOOK` | production environment variable | Narrow production Edge Runtime deploy-hook URL |
| `DOKPLOY_URL` | production environment variable | Dokploy origin, without `/api` |
| `DOKPLOY_APPLICATION_ID` | production environment variable | Production frontend application ID |
| `GHCR_PULL_USERNAME` | production environment variable | GitHub service-account username used only to pull |
| `BACKUP_CHECK_URL` | production environment variable | Authenticated backup-freshness check endpoint |

Environment secrets:

| Name | Enter at | Minimum capability |
| --- | --- | --- |
| `SUPABASE_DB_URL` | production environment secret | Direct production Postgres migration connection |
| `FUNCTION_DEPLOY_SECRET` | production environment secret | Authenticate only the production function deploy hook |
| `DOKPLOY_API_KEY` | production environment secret | Read/update/deploy only the production application |
| `GHCR_PULL_TOKEN` | production environment secret | Classic PAT with `read:packages` only |
| `BACKUP_CHECK_TOKEN` | production environment secret | Read only the backup-health result |

`GITHUB_TOKEN` is created by GitHub for each workflow run. Do not create a
secret with that name. Keep the repository's default workflow permission at
read-only; the staging workflow explicitly requests `packages: write`, and the
production workflow explicitly requests `packages: read` and `actions: read`.

## Rulesets and required checks

Create an active branch ruleset targeting the default branch (`main`):

- require a pull request with at least one approval;
- dismiss stale approvals and require approval of the latest reviewable push;
- require conversation resolution;
- block force pushes and branch deletion;
- require the branch to be up to date; and
- require these GitHub Actions job names from the GitHub Actions source:
  `application`, `browser`, `database`, `dependency-review`, and `secret-scan`.

First run the PR workflow once so GitHub can offer the check names. Dependency
review requires GitHub's supported repository visibility/plan and the dependency
graph. If it is unavailable, record that platform limitation and replace it with
an approved dependency policy check before making it required; do not leave a
permanently missing required check.

Create a separate active tag ruleset targeting `v*`:

- restrict tag updates and deletions;
- restrict tag creation to the named release manager(s), with no broad bypass;
- require signed tags if the release managers have signing configured; and
- keep the production workflow's independent annotated-tag and strict semantic
  version checks.

## GHCR

The staging workflow publishes `ghcr.io/<owner>/<repository>:<commit-sha>` with
its job-scoped `GITHUB_TOKEN`, then deploys `ghcr.io/<owner>/<repository>@sha256:...`.
Connect the package to this repository and grant this repository's Actions
access to write the package. Do not grant package deletion.

For Dokploy pulls from a private package, use a dedicated service account and a
classic PAT with `read:packages` only. Give the account read access to this
package/repository and authorize organization SSO only if the owner requires it.
Store the username and token separately in each GitHub environment as listed
above. A public GHCR package can be pulled anonymously, but this runbook keeps
authentication explicit unless public distribution has been approved.

## Dokploy

Create separate staging and production applications. Configure both as Docker
provider applications and set the container port to `8080` with health endpoint
`/healthz`. Enter the runtime values from `docs/environments.md` in Dokploy, not
GitHub Actions.

Create a distinct member/token for each environment. Grant API/CLI access plus
only application read, update, and deploy rights for that environment when the
installed Dokploy edition supports fine-grained permissions. Do not use an owner
token. The workflow uses these current API operations:

- `GET /api/application.one` to record the current image and poll status;
- `POST /api/application.saveDockerProvider` to set an immutable digest and
  read-only GHCR credentials; and
- `POST /api/application.deploy` to start the deployment.

The script fails on an unpinned image, an unknown/error status, or a ten-minute
timeout. This command validates inputs without contacting Dokploy:

```sh
DOKPLOY_URL=https://dokploy.invalid \
DOKPLOY_API_KEY=placeholder \
DOKPLOY_APPLICATION_ID=placeholder \
DEPLOY_IMAGE=ghcr.io/example/app@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
GHCR_PULL_USERNAME=placeholder \
GHCR_PULL_TOKEN=placeholder \
DOKPLOY_DRY_RUN=true \
sh scripts/dokploy-deploy.sh
```

Before the first real staging deployment, verify the three endpoints and the
returned `applicationStatus` values against the installed instance's protected
`/swagger` page. Also disable any competing Dokploy Git/registry auto-deploy
webhook so GitHub Actions is the sole release controller.

## Evidence and approval record

For every accepted staging release retain:

- the successful `CI` and `Deploy staging` run URLs;
- `accepted-release-<commit-sha>` containing the commit, image digest, and last
  migration identifier;
- the staging deployment record and smoke/E2E logs; and
- confirmation that the deployed Dokploy image contains the same digest.

For production, record the annotated tag, staging acceptance artifact, required
reviewer, backup check, previous digest artifact, resulting Dokploy deployment,
and smoke result. A production tag or deployment must not be used merely to test
this setup.

## Step 4 validation record — 2026-09-02

Repository-side validation completed without contacting a deployment target:

- all three workflow YAML files parse;
- shell syntax checks pass for every deployment/helper script;
- the repeatable `npm run test:cicd` check proves the Dokploy dry-run accepts an
  immutable digest without API calls, rejects a mutable image tag, and resolves
  a mocked staging acceptance artifact to its recorded digest;
- the locked Supabase CLI is `2.116.0`; its help confirms `db push` supports the
  used `--db-url`, `--include-all`, and `--dry-run` flags;
- ESLint, Deno lint/check, three Deno tests, six Vitest tests, the Vite build,
  hardcoded-domain scan, and the Playwright public journey pass; and
- static inspection confirms the production workflow contains no image build
  step, while staging contains the sole `docker/build-push-action` step.

External configuration is **pending**, not assumed complete:

- GitHub CLI authentication for `malabdullah` is invalid and the available
  browser session is signed out. Repository visibility/plan, environments,
  secrets/variables, rulesets, Actions runs, and GHCR package access could not
  be inspected or changed.
- No Dokploy endpoint or credential is present in repository files (as expected),
  so the installed Dokploy version, application IDs, permissions, API responses,
  and deployed image references could not be inspected.
- `supabase/.baseline-ready` is absent. Database replay and all staging or
  production deployment actions remain blocked by design.
- No production tag was created and no production workflow or deployment was
  triggered.

Complete these approval steps in order:

1. Restore GitHub admin authentication and confirm repository visibility/plan.
2. Create both environments and enter only the variables/secrets listed above.
3. Configure the main and tag rulesets; confirm dependency-review availability.
4. Configure GHCR repository linkage and the two read-only Dokploy pull tokens.
5. Create the separate Dokploy applications/tokens, verify the API contract in
   that instance's `/swagger`, and disable competing auto-deploy hooks.
6. Open a non-fork test PR and verify only the five CI jobs run and no deployment
   environment or deployment secret is requested.
7. Finish and approve `docs/database-baseline.md`; only then commit
   `supabase/.baseline-ready` through review.
8. Merge an approved commit to `main`. Verify the one SHA-tagged GHCR image, its
   acceptance artifact digest, the Dokploy digest, and the staging release string
   are identical.
9. Leave production untested until launch authority, backup/restore readiness,
   and an approved semantic release are all present.
