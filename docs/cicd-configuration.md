# CI/CD Configuration

This document records credential names and trust boundaries, never values.
Staging and production configuration must remain separate.

## Workflow trust boundaries

- `CI` runs for pull requests and pushes to `main` with `contents: read`. It has
  no deployment environment and receives no deployment secrets.
- `Deploy staging` starts only after a successful same-repository `CI` push run
  for `main`. Its build job runs on GitHub-hosted Linux and is the only staging
  job allowed to write the GHCR package.
- The staging deployment job requires all four runner labels: `self-hosted`,
  `macOS`, `ARM64`, and `barber-staging`. It receives only the `staging`
  environment values and operates on the isolated Docker Desktop stack.
- `Promote production` runs only for a protected semantic `vX.Y.Z` tag. It must
  reuse the accepted staging digest without rebuilding and must receive an
  independent production approval.
- `supabase/.baseline-ready` remains an intentional hard gate. Migration pushes
  use `--skip-vault`.

Never enable a self-hosted runner for workflows triggered by untrusted pull
request code. The current runner is repository-scoped and appears only in the
post-CI staging deployment job.

## GitHub environments

### `staging`

Variables:

| Name | Meaning |
| --- | --- |
| `APP_URL` | `https://staging-barber.malabdullah.cloud` |
| `SUPABASE_URL` | `https://supabase-staging.malabdullah.cloud` |

Secrets:

| Name | Minimum capability |
| --- | --- |
| `ACCESS_CLIENT_ID` | Cloudflare Access service-token ID for staging checks |
| `ACCESS_CLIENT_SECRET` | Matching service-token secret |

The runner's owner-only `.secrets/functions.env` stores staging Edge Function
values locally. Database and Storage access stays local to Docker. No Dokploy,
database URL, GHCR PAT, or function-hook credential is required for staging;
the job-scoped `GITHUB_TOKEN` authenticates its GHCR push and pull.

### `production`

Production retains the separate variables and secrets referenced by
`.github/workflows/deploy-production.yml`: production frontend and Supabase
origins, direct migration URL, function deploy hook and secret, backup monitor
URL and token, Dokploy URL/application/API key, and read-only GHCR pull
credentials. Do not copy staging values into these fields.

Production must allow only protected `v*` tags, require an independent reviewer,
prevent self-review, and expose secrets only after approval. If the GitHub plan
does not support these controls, production promotion is not ready.

`GITHUB_TOKEN` is created per workflow run. Do not create a stored secret with
that name. Keep default workflow permissions read-only; individual deployment
workflows request only the additional package/action access they require.

## Required repository rules

Protect `main` with:

- pull requests and at least one approval;
- stale-approval dismissal and approval of the latest reviewable push;
- resolved conversations and an up-to-date branch;
- blocked force pushes and deletion; and
- required GitHub Actions checks `application`, `browser`, `database`,
  `dependency-review`, and `secret-scan`.

Protect `v*` tags from unauthorized creation, update, and deletion. Keep the
production workflow's annotated-tag and strict semantic-version checks.

The current private repository is on GitHub Free. Both repository rulesets and
classic branch protection returned GitHub HTTP 403. This is a recorded hard
block: do not merge/deploy until GitHub Pro/Team protection is enabled or the
repository is intentionally made public. No workflow or local hook is treated
as an equivalent server-side protection.

## GHCR and local staging runner

The build job publishes
`ghcr.io/malabdullah/barberplusplus:<commit-sha>`, records its registry digest,
and passes `ghcr.io/malabdullah/barberplusplus@sha256:...` to the deployment job.
The local helper rejects a mutable tag or a different repository.

The runner is named `barber-staging-mac`, is scoped to this repository, and is
installed below `/Users/malabdullah/actions-runner-barber-staging`. Its protected
subdirectories hold only staging secrets, launch-service state, and local
database/Storage backups. The runner must remain online, Docker Desktop must be
healthy, and the Cloudflare tunnel must be connected before merging.

The deployment keeps the previous frontend container stopped but recoverable
until all checks and evidence uploads succeed. Failure restores it. Database
migrations use the isolated local connection, and the staging Edge Functions
service is managed by a dedicated macOS launch agent.

## Evidence

Retain for each accepted staging release:

- the successful `CI` and `Deploy staging` run URLs;
- `accepted-release-<commit-sha>` with the commit, immutable digest, workflow
  run, latest migration, and migration-tree hash;
- sanitized backup evidence with database and Storage checksums and sizes;
- smoke, Cloudflare boundary, and Playwright results; and
- confirmation that the live runtime release matches the accepted commit.

Raw staging backups remain owner-only on the Mac and must not be uploaded as
workflow artifacts. An encrypted off-device copy and restore rehearsal remain
separate readiness requirements.
