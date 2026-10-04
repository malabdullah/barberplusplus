# CI/CD Configuration

> The repository now contains the fail-closed VPS workflow scaffold. It builds
> immutable frontend and Edge Functions images, but intentionally stops before
> deployment until the live backup/migration/recovery adapters and first-cutover
> evidence are reviewed. Do not set `STAGING_VPS_AUTOMATION_READY=true` yet.

This document records credential names and trust boundaries, never values.
Staging and production configuration must remain separate.

## Workflow trust boundaries

- `CI` runs for pull requests and pushes to `main` with `contents: read`. It has
  no deployment environment and receives no deployment secrets.
- `Deploy staging` starts only after a successful same-repository `CI` push run
  for `main`. Its build job runs on GitHub-hosted Linux and is the only staging
  job allowed to write the GHCR package.
- The checked-in staging deployment scaffold currently names a Linux
  self-hosted runner, but that runner must not be registered while this remains
  a public personal-account repository. GitHub warns that pull requests against
  public repositories can compromise self-hosted runners. A PR can add a new job
  targeting the runner labels without referencing the protected `staging`
  environment; labels are routing metadata, not an authorization boundary.
- `Promote production` runs only for a protected semantic `vX.Y.Z` tag. It must
  reuse the accepted staging digest without rebuilding and must receive an
  independent production approval.
- `supabase/.baseline-ready` remains an intentional hard gate. Migration pushes
  use `--skip-vault`.

Never enable a self-hosted runner for workflows triggered by untrusted pull
request code. Current sources:

- [GitHub secure-use reference](https://docs.github.com/en/actions/reference/security/secure-use)
- [GitHub runner-group access controls](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/manage-access)
- [GitHub adding self-hosted runners](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/add-runners)

## GitHub environments

### `staging`

Deployment approval is now enforced by the GitHub environment (2026-09-28):
`malabdullah` is its sole required reviewer and may approve a run they triggered.
Only protected branches may deploy. Policy-change approval is not approval of a
particular release. The owner must review and approve each staging deployment.
The existing workflow already references `environment: staging`; no workflow
edit or deployment was needed to enable this gate. See
[owner approval policy](staging-owner-approval.md) for the explicitly approved
shared-main policy. Main requires PRs and all five checks, but no second-person
approval. A recorded code review and owner release-specific approval are still
required by the deployment procedure.

Variables:

| Name | Meaning |
| --- | --- |
| `APP_URL` | `https://staging-barber.malabdullah.cloud` |
| `SUPABASE_URL` | `https://supabase-staging.malabdullah.cloud` |
| `DOKPLOY_URL` | `http://127.0.0.1:3000`; never a public management URL |
| `DOKPLOY_PROJECT_ID` | Existing isolated staging project ID |
| `DOKPLOY_ENVIRONMENT_ID` | Existing staging environment ID |
| `DOKPLOY_FRONTEND_APPLICATION_ID` | Created frontend application resource ID |
| `DOKPLOY_SUPABASE_COMPOSE_ID` | Created Supabase Compose resource ID |
| `STAGING_VPS_AUTOMATION_READY` | Keep unset/`false` until every readiness gate below passes |

Secrets:

| Name | Minimum capability |
| --- | --- |
| `ACCESS_CLIENT_ID` | Cloudflare Access service-token ID for staging checks |
| `ACCESS_CLIENT_SECRET` | Matching service-token secret |
| `DOKPLOY_API_KEY` | Dedicated staging-only token; application/compose read, update, and deploy only |
| `GHCR_PULL_USERNAME` | Dedicated package reader identity used by Dokploy |
| `GHCR_PULL_TOKEN` | Classic PAT with `read:packages` only; no repository scope when avoidable |

Supabase runtime secrets remain in Dokploy/VPS configuration and are not copied
to GitHub. The job-scoped `GITHUB_TOKEN` publishes images; it is not stored as a
secret. PR CI has no `environment:` stanza and therefore cannot receive any of
the staging secrets above.

Before enabling automation, implement and review the three versioned adapters
proposed in [VPS deployment adapter contract](staging-vps-deployment-adapters.md):

1. Backup capture: quiesce the isolated stack and capture Database, Auth, Vault,
   Storage, encrypted configuration, and the complete PostgreSQL `db-config`
   volume containing `pgsodium_root.key`; restore that volume before PostgreSQL
   starts; bind evidence to commit, image digests, and migration tree; verify
   off-VPS receipt and a Vault-inclusive restore rehearsal. Preserve Storage
   `user.*` xattrs, ACLs, numeric ownership, and HTTP metadata with pinned GNU
   tar, then verify recovered content and metadata through the Storage API.
2. Migration apply: validate history, run the exact candidate dry-run, then
   apply with `--skip-vault`; never seed/reset a nonempty staging database.
3. Rollback/recovery: retain prior immutable frontend and Functions digests;
   roll application images back, but use database forward-fix or reviewed
   recovery only—never an automatic destructive migration downgrade.

Adapters must accept and return only evidence-file paths, hashes, digests, and
release identifiers. They must not print secrets. Owner approval of a staging
job is separate from adapter readiness and evidence verification. Privileged
capture/migration operations must go through the constrained root-owned broker
defined by the contract; the deployment identity never receives Docker, sudo, or arbitrary
root execution. Initial provisioning of the absent stack is a separate
owner-approved bootstrap gate and cannot claim prior-backup evidence.

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

- pull requests, with zero required second-person approvals under the explicitly
  approved solo-owner policy;
- stale-review dismissal retained, but no separate latest-push approval;
- resolved conversations and an up-to-date branch;
- blocked force pushes and deletion; and
- required GitHub Actions checks `application`, `browser`, `database`,
  `dependency-review`, and `secret-scan`.

Protect `v*` tags from unauthorized creation, update, and deletion. Keep the
production workflow's annotated-tag and strict semantic-version checks.

The repository is public on GitHub Free so server-side branch protection is
available. `main` requires the five app-bound checks above, stale-review
dismissal, conversation resolution, and an up-to-date branch. Administrators are
included; force pushes and deletion are disabled. On 2026-09-28 the owner
explicitly approved removing only the independent PR approval count and
latest-push approval from this shared branch. All other fields were verified
unchanged. Do not further weaken controls to complete a release.

## GHCR and deployment executor

The build job publishes two commit-SHA tags and passes only their registry
digests to deployment:

- `ghcr.io/malabdullah/barberplusplus@sha256:...`
- `ghcr.io/malabdullah/barberplusplus-functions@sha256:...`

The preflight rejects mutable tags, other repositories, unexpected Dokploy
project/environment IDs, and any Dokploy URL other than loopback. Production
continues to resolve the accepted frontend digest from staging evidence and
does not rebuild it.

The approved default architecture is GitHub-hosted CI plus a restricted
server-side pull/deployment mechanism that consumes only a verified commit and
immutable digests after the protected staging approval. It must use the
constrained broker contract, cannot accept arbitrary commands or repository
code execution, and keeps Dokploy/database credentials on the server. The
versioned envelope, authenticity, expiry, replay ledger, and observation-only
first installation stage are specified in
[VPS deployment adapter contract](staging-vps-deployment-adapters.md#approved-release-pull-protocol-proposed-v1).

Do not register the checked-in `barber-staging-vps` runner. Keeping
`STAGING_VPS_AUTOMATION_READY` false and retaining the deliberate workflow stop
does not make a repository-level runner safe: an attacker can define a separate
PR job without either gate. The existing first-time-contributor workflow
approval setting is also not a durable runner boundary for later pull requests.

Two safe alternatives require separate owner authorization and are not approved
by the current setup instruction:

1. Move runner control to an organization runner group restricted to this
   repository and specifically to
   `malabdullah/barberplusplus/.github/workflows/deploy-staging.yml@refs/heads/main`.
2. Place deployment automation and its runner in a separate private deployment
   repository, accepting only signed/verified release evidence from this public
   repository.

Moving the repository, creating an organization or private repository, changing
the GitHub plan, or changing Actions policy requires a new explicit decision.
Until then, only the server-side pull architecture may proceed. The deployment
workflow remains fail-closed and must be revised before merge.

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
