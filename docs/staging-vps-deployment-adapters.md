# Staging VPS Deployment Adapter Contract (Proposed v1)

Status: proposal for Env3 and owner review. These paths and schemas are not yet
approved or implemented. The staging workflow must remain fail-closed.

## Common rules

Each adapter runs locally on the staging VPS through a dedicated, unprivileged
server-side deployment identity, not a GitHub self-hosted runner registered to
the current public repository. Inputs and outputs exposed to GitHub are
non-secret release identifiers, immutable image digests, evidence paths, and
SHA-256 checksums only.
Adapters resolve runtime credentials from owner-controlled local configuration,
never from command-line arguments, and must not print secrets or backup data.

The deployment identity cannot directly use `sudo`, the Docker socket, or database operator
credentials. Privileged operations require a separately reviewed, root-owned
broker with a fixed protocol. The broker must expose only named staging
operations, validate every identifier/digest/path against an allowlist, use
fixed root-owned executable code and configuration, and return sanitized
evidence. It must not expose arbitrary commands, arguments, filesystem paths,
Docker API access, or deployment-identity-editable privileged scripts. A broad Dokploy owner
token is not an acceptable substitute.

Every adapter accepts `DEPLOY_SHA`, `FRONTEND_IMAGE`, `FUNCTIONS_IMAGE`, and a
broker-issued evidence identifier. The deployment identity never supplies an arbitrary
output path. The broker writes evidence beneath the fixed root-owned
`/var/lib/barber-staging/evidence/<commit>/` tree and returns only its identifier
and checksum. It refuses mutable images, production identifiers, missing
baseline readiness, an unexpected migration tree, symlinks, or a pre-existing
output. Evidence uses schema identifier
`barber-staging-deployment-evidence/v1`.

## Proposed constrained broker

The minimum broker design is a root-owned systemd service listening on
`/run/barber-staging-broker.sock`. The socket is `0660 root:barber-staging-release`;
only the dedicated deployment account belongs to that group. The executable lives
under `/usr/local/libexec/`, configuration under `/etc/barber-staging-broker/`,
and both are non-writable by the deployment identity. The service authenticates the Unix peer
credentials and accepts a versioned JSON request with only these operations:

- `status.inspect` — sanitized isolated-stack and bootstrap readiness;
- `backup.capture` — fixed quiesce/capture/resume sequence and evidence output;
- `migration.apply` — verified history, dry-run, then `--skip-vault` apply tied
  to matching backup evidence; and
- `images.rollback` — restore only previously recorded immutable application
  digests and run fixed health checks.

The service chooses every command, container/resource name, credential file,
and filesystem path. Requests cannot contain commands, executable paths, Docker
arguments, database URLs, secret values, or paths outside the fixed evidence
tree. Bootstrap is deliberately not exposed as an automation operation; the
owner executes the reviewed first-provisioning procedure separately.

## Approved-release pull protocol (proposed v1)

The current public repository uses GitHub-hosted CI only. After successful CI
for a same-repository push to protected `main`, a GitHub-hosted job referencing
the protected `staging` environment waits for the owner's release-specific
approval. Only that post-approval job may create a release-request artifact.
It receives no Dokploy, server, database, or broker credential.

Workflow permissions remain read-only by default. The build job alone receives
`packages: write`; it receives no OIDC token or attestation permission. The
post-approval evidence job alone receives `id-token: write` and
`attestations: write`, declares `environment: staging`, performs no checkout,
and cannot publish or deploy an image. The allowlisted workflow blob must retain
this separation.

The server-side pull service makes outbound requests to GitHub. It exposes no
public webhook or command endpoint and never accepts a pushed request. Its
GitHub identity is repository-scoped and read-only: Metadata, Contents, Actions
run/job/artifact evidence, and Attestations. GHCR image pulling uses a separate
package-read identity stored in Dokploy. The pull identity cannot write source,
workflows, checks, deployments, packages, or repository policy.

GitHub sources for this design:

- [OIDC security hardening](https://docs.github.com/en/actions/concepts/security/openid-connect)
- [Artifact attestations](https://docs.github.com/en/actions/concepts/security/artifact-attestations)
- [`gh attestation verify` reference](https://cli.github.com/manual/gh_attestation_verify)
- [Actions artifacts REST API](https://docs.github.com/en/rest/actions/artifacts)
- [Workflow runs REST API](https://docs.github.com/en/rest/actions/workflow-runs)
- [Workflow-run approval history API](https://docs.github.com/en/rest/actions/workflow-runs#get-the-review-history-for-a-workflow-run)

### Release-request envelope

The artifact contains exactly a bounded JSON envelope and its GitHub/Sigstore
attestation bundle. Archives with extra entries, links, traversal, duplicate
names, unbounded data, or non-regular files are rejected. The envelope is at
most 16 KiB, uses schema `barber-staging-release-request/v1`, has no unknown
fields, and contains only:

- action `deploy-staging`, repository numeric ID and exact `owner/name`;
- workflow path plus the allowlisted workflow blob SHA;
- source CI run ID/attempt and release-request run ID/attempt;
- full lowercase 40-character commit SHA and branch `main`;
- exact frontend and Functions GHCR repositories plus 64-character SHA-256
  digests—never tags;
- migration-tree SHA-256 and latest migration identifier;
- environment `staging` and expected staging origins;
- UTC `issued_at` and `expires_at` no more than 15 minutes apart; and
- a cryptographically random 128-bit nonce and derived request ID
  `<repository-id>:<run-id>:<attempt>:<nonce>`.

The post-approval job attests the envelope digest and both image subjects using
GitHub OIDC/artifact attestations. The server verifies the attestation issuer,
repository owner and numeric repository ID, protected workflow identity, main
branch/ref, commit, GitHub-hosted runner, run/attempt URI, public visibility,
subject names, and subject digests. A valid signature alone is insufficient;
all GitHub metadata and local allowlists below must also pass.

Important correction: current GitHub/Fulcio certificate extensions do **not**
contain the Actions environment name, job/check ID, or deployment reviewer.
`gh attestation verify` can enforce repository/workflow/source identity and
digests, but cannot prove `staging` approval. Predicate metadata is controlled
by the signing workflow and must not be promoted into a trust claim. Environment
approval is established separately from the GitHub workflow-run approval
history endpoint, requiring an `approved` record for the exact release run,
environment ID/name, and owner reviewer ID. The pinned workflow blob must also
show that the envelope-attesting step belongs to the `environment: staging` job.

### Server verification

Before any broker request, the pull service independently verifies through the
GitHub API that:

1. The release-request run used the allowlisted workflow path and blob SHA,
   originated from the expected repository, targeted `main`, used the envelope
   commit, and completed successfully.
2. The named source CI run is the successful same-repository `push` run for that
   commit and workflow attempt.
3. The release run's approval history contains an `approved` decision for the
   exact staging environment and configured owner reviewer. The attestation run
   URI matches that run and attempt. The reviewed workflow blob places envelope
   generation/attestation only in its `environment: staging` job. Any workflow
   blob change requires an out-of-band allowlist update and review.
4. Both GHCR manifests exist at the exact digests, their attestations match the
   envelope and commit, and no mutable tag is used for deployment.
5. The baseline marker, migration-tree evidence, repository/environment IDs,
   origins, timestamps, and all fixed constants match the reviewed local policy.
6. Server time is synchronized, the request is not expired or from the future,
   and its request ID, run attempt, nonce, commit/digest tuple, and artifact ID
   have never been accepted before.

The service downloads no source archive, performs no checkout, evaluates no
repository script, and treats every envelope value as data. It maps the validated
fixed action to the broker's fixed operations; the request cannot name commands,
services, containers, hosts, paths, environment variables, or credentials.

### Replay and state handling

The pull service and root-owned broker maintain independent append-only ledgers.
Acceptance moves a request atomically through `observed`, `verified`,
`authorized`, `executing`, then `consumed` or terminal `failed`. A request ID,
run attempt, nonce, artifact ID, or exact commit/digest tuple already present in
either ledger cannot start another deployment. Process restart resumes evidence
inspection but never repeats a side effect automatically. Retry requires a new
owner-approved workflow **run ID**—not a GitHub rerun attempt—plus a new nonce,
expiry, and request ID. Rollback uses
the separately recorded previous immutable digests and is never represented as
a replay of the rejected request.

Expiry is checked once before broker authorization and again immediately before
the first side effect. Expiry during an already-started fixed broker transaction
does not interrupt recovery; the broker finishes or rolls back according to its
local state machine and records terminal evidence.

### Smallest safe first installation stage

Install only an observation-mode pull verifier under a dedicated unprivileged
account. It has no broker-socket group membership, Dokploy/API key, GHCR pull
credential, Docker access, database access, `sudo`, deployment action, or inbound
listener. `STAGING_VPS_AUTOMATION_READY` remains false and the checked-in
workflow remains deliberately stopped.

The observation service may read only public repository metadata plus synthetic
local protocol fixtures initially. After a separate approval for a repository-
scoped read identity, it may poll and validate deliberately non-deployable test
envelopes, write sanitized decisions to its own state directory, and prove
expiry/replay/restart behavior. Broker socket access and real approved-release
consumption are later stages requiring their own review and explicit approval.

### Local syntax validator status

`scripts/staging-release-envelope.mjs` implements only the pure, strict envelope
parsing layer. Its adversarial Node tests are in
`scripts/staging-release-envelope.node-test.mjs` and run directly with:

```sh
node --test scripts/staging-release-envelope.node-test.mjs
```

The parser enforces the byte limit, canonical compact JSON, exact recursively
ordered fields and types, fixed repository/workflow/environment/origin/image
constants, full commit/blob hashes, immutable digests, migration identifiers,
run IDs/attempts, the 15-minute window, future skew, 128-bit nonce, and derived
request-ID binding. A successful result explicitly returns `authorizing: false`
and lists every external authorization check still required.

The implementation does **not** verify GitHub or Sigstore attestations, OIDC
claims, environment approval, workflow/CI API metadata, workflow blob allowlist,
GHCR manifests, migration evidence, trusted server time, persistent replay
state, or broker authorization. It performs no I/O and has no credential,
network, filesystem, subprocess, polling, service, or deployment capability.
It is not wired into a workflow or package script. Those gaps remain hard gates;
syntactic validity must never be treated as release authorization.

### Local attestation adapter status

`scripts/staging-attestation-verifier.mjs` delegates signature, certificate,
timestamp, subject-digest, and trusted-root verification to the installed
official GitHub CLI; it implements no signature cryptography. It constructs an
offline `gh attestation verify` invocation using a local bundle and trusted root
with exact repository, predicate, OIDC issuer, certificate SAN, signer commit,
source commit/ref, and GitHub-hosted runner constraints. It then fail-closes on
the verified certificate summary unless repository/owner numeric IDs, workflow
and source URIs/digests, event, visibility, and exact run/attempt URI match.

The exported pure JSON parser does not perform cryptography and returns only
`status: certificate-policy-output-valid` with `cryptographyVerified: false`.
Only the wrapper that directly invokes the allowlisted `gh` executable without
a shell, observes a successful exit, and then validates its output returns
`status: cryptography-and-certificate-policy-valid` with
`cryptographyVerified: true`. Both paths always return `authorizing: false`.

Synthetic and negative adapter tests run with:

```sh
node --test scripts/staging-attestation-verifier.node-test.mjs
```

The tests mock only the CLI execution boundary; they do not claim a real
signature was verified. Regression assertions prevent caller-supplied JSON from
being labeled cryptographically verified. The adapter always returns
`authorizing: false`.
It cannot verify environment approval or a job identity because those claims
are absent from current Fulcio certificate extensions. Workflow-run metadata,
the approval-history response, current environment policy, allowlisted workflow
blob, envelope syntax, image attestations, migration evidence, trusted clock,
replay ledger, and broker authorization remain mandatory independent gates.
No attestation bundle or trusted-root material is currently installed.

### Local staging-approval evidence status

The official approval-history endpoint is scoped by workflow `run_id` and
returns decision state, environments, and reviewer identity. It does not return
`run_attempt`, job/check ID, or approval timestamp. GitHub reruns reuse the run
ID, so historical approval evidence cannot distinguish approval of attempt 1
from approval of attempt 2 or later.

`scripts/staging-approval-evidence.mjs` is a pure, non-authorizing policy
validator for fixture/API-shaped evidence. It checks the current environment ID
and name, protected-branch-only policy, sole owner reviewer numeric identity,
repository/head-repository IDs and names, successful workflow-run event, main
branch, exact commit and run attempt, workflow path, and reviewed workflow
source against both its Git blob SHA and an independently allowlisted SHA-256.
It also requires one unambiguous owner approval for only the staging environment.

The only attempt it can bind safely is `run_attempt: 1`, because no earlier
attempt exists for that run ID. For every later attempt it returns
`blocked-approval-not-bound-to-run-attempt`, `attemptBound: false`, and the exact
missing proof. Reruns must never deploy; a retry requires a wholly new workflow
run and new owner approval. Ambiguous, absent, rejected, extra, wrong-reviewer,
or wrong-environment histories return a separate blocked result.

Tests run with:

```sh
node --test scripts/staging-approval-evidence.node-test.mjs
```

Fixtures do not authenticate a GitHub response or prove a real approval. The
module always returns `authorizing: false`; API response origin,
attestation, envelope, images, migration evidence, clock, replay ledger, and
broker authorization remain independent gates.

### Local release-artifact binding status

`scripts/staging-release-evidence.mjs` composes the preceding policy results
without replacing any of them. It requires exactly one canonical envelope,
cryptography-and-certificate policy result, first-attempt approval result,
GitHub artifact record, downloaded archive record, and migration record, plus
exactly one frontend and one Functions image record.

The binding requires all of the following to agree:

- repository numeric ID/name, commit, workflow blob, CI run/attempt, and release
  run/attempt;
- the non-expired GitHub artifact's ID, deterministic name, archive digest,
  archive size, repository/head-repository IDs, branch, commit, and creation
  time inside the envelope window;
- an archive containing exactly one regular `staging-release-request.json`
  entry whose bytes match the attested envelope SHA-256;
- frontend and Functions repositories, immutable digests, commit, and source CI
  run/attempt; and
- migration commit, migration-tree digest, and latest migration identifier.

It produces a canonical binding hash and compares supplied replay-ledger records
against the binding hash, request ID, artifact ID, envelope digest, and exact
commit/image/migration tuple. Matching records return
`blocked-replayed-release-evidence`; expired requests return
`blocked-stale-release-evidence`; missing, duplicate, or role-ambiguous inputs
return `blocked-ambiguous-release-evidence`. Mismatched identities are rejected.

Tests run with:

```sh
node --test scripts/staging-release-evidence.node-test.mjs
```

The module always returns `authorizing: false`. Fixture records do not prove API
origin, registry state, migration capture, trusted time, or durable replay
state. Read-only transport is described below. Trusted time, a root-owned
append-only replay snapshot, reviewed workflow/source allowlists, migration
capture, and broker authorization remain separate prerequisites.

### Local read-only evidence transport status

`scripts/staging-evidence-transport.mjs` adds bounded, non-authorizing transport
for the evidence validators. Its GitHub adapter invokes an allowlisted absolute
`gh` binary with `GET` only and queries exactly the selected workflow run, its
approval history, the current `staging` environment, one artifact record, the
staging workflow file at the exact lowercase commit SHA, and that artifact's ZIP
download. It does not create, update, approve, rerun, dispatch, or deploy
anything.

The artifact ZIP is never extracted. A memory-only inspector limits the archive
to 1 MiB and the canonical envelope to 16 KiB, requires exactly one regular
`staging-release-request.json` entry, and rejects ZIP64, links, directories,
encryption, unsafe flags or methods, traversal or alternate names, comments,
trailing or hidden bytes, unsafe compression ratios, inconsistent descriptors,
invalid UTF-8, and size or CRC mismatches. The adapter records both the archive
SHA-256 and the single entry SHA-256 for the binding validator.

The GHCR adapter accepts only the two reviewed Barber++ repositories and an
immutable lowercase `sha256:` digest. It first attempts an anonymous public
manifest read, follows only the exact GHCR public bearer-token challenge, and
requires the response body digest and `Docker-Content-Digest` to equal the
requested digest. Redirects and unexpected media types fail closed. If a
package is private or anonymous pull is unavailable, this result is blocked;
the exact missing capability is a dedicated read-only identity with
`read:packages`. No such credential is created or accepted by this adapter.

Tests run with:

```sh
node --test scripts/staging-evidence-transport.node-test.mjs
```

The tests use bounded synthetic archives and mocked HTTP/CLI boundaries. They
do not prove a live GitHub response, a real environment approval, a published
artifact, or a live GHCR manifest. Inaccessible approval history is not success.
The adapter always returns `authorizing: false`; authenticated host/token scope
review, exact policy-validator composition, image attestations, migration
evidence, trusted time, persistent replay protection, approved workflow/source
allowlists, and the constrained broker remain required before activation. The
current repository state has no qualifying live release artifact to validate
end to end, so no remote workflow or staging deployment was triggered.

### Read-only activation probe — 2026-10-04

With unrestricted network access, the local GitHub CLI authenticates
successfully as owner `malabdullah` (user ID `19295903`). The keyring-backed
interactive token reports scopes `gist`, `read:org`, `repo`, and `workflow`;
no token value was read or printed. Those scopes are sufficient for the real
GitHub run, approval, environment, contents, and artifact GETs exercised below,
but they are broader than the observation service requires and must not be
copied to the VPS or treated as the planned machine identity. An earlier local
status check made under restricted network incorrectly appeared as invalid and
is superseded by this network-enabled verification.

Real, non-authorizing collection against draft PR 3 and workflow run
`37192236004` established the following:

- PR 3 is open and draft. Its head is
  `aecdbc69e6c2f2a37e53d3b54badb1b95f3144fd` on
  `codex/staging-completion`, and its base is `codex/staging-vps`.
- Run `37192236004` is successful first-attempt `pull_request` CI from
  `.github/workflows/ci.yml`; it is not a `main` push or a staging release run.
- The approval-history response is the empty array. Absence of a rejection does
  not constitute approval.
- The current `staging` environment still has ID `21158713380`, protected-
  branches-only policy, and exactly one required reviewer: owner user ID
  `19295903`.
- The staging workflow at that PR commit is readable and has Git blob SHA
  `77a67514646af4f4b90d4fcfd6849ec09221d68c`. Observing a blob does not place it
  on the approved source allowlist.
- The run has one artifact, ID `11298454359`, named
  `gitleaks-results.sarif`. It is not a staging release-request artifact. The
  hardened real collector rejects its name before download because it is not
  `staging-release-request-aecdbc69e6c2f2a37e53d3b54badb1b95f3144fd-37192236004-1`.
- Anonymous GHCR token requests for both `malabdullah/barberplusplus` and
  `malabdullah/barberplusplus-functions` returned `403`. The authenticated
  identity also receives `403` from the Packages API with the explicit message
  that `read:packages` is required. No public immutable manifest could be
  collected and no credential scope was changed.

This probe proves fail-closed transport behavior only. It supplies no staging
approval, release envelope, image digest, image attestation, migration evidence,
trusted time, replay state, or deployment authorization.

### Exact installation and permissions plan (not activated)

The following stages are ordered gates. No later privilege is installed until
the prior stage has independent evidence and explicit owner approval.

1. **Observation identity and GitHub reads.** Create a dedicated GitHub App
   installation limited to the single `malabdullah/barberplusplus` repository.
   Grant repository permissions `Metadata: read`, `Actions: read`,
   `Contents: read`, and `Attestations: read` only. Grant no Administration,
   Checks, Deployments, Environments write, Issues, Pull requests, Secrets,
   Workflows write, or Packages write permission. Use short-lived installation
   tokens delivered to the observation service through a root-readable systemd
   credential; never place a token in the repository, unit `Environment=`,
   process arguments, logs, or the deployment account's home directory. The
   service may make only the allowlisted GET requests implemented by the
   collector. GitHub documents `Actions: read` for workflow-run, approval,
   environment, artifact-record, and artifact-download GETs and `Contents:
   read` for the exact workflow blob. The current interactive owner token is
   adequate for manual read-only inspection but is explicitly not this service
   identity because it carries `repo` and `workflow` scope.
2. **Separate GHCR pull identity.** Because the two packages are not publicly
   readable, create a separate personal access token (classic) with only
   `read:packages`, owned by a dedicated read-only machine identity with access
   to exactly the two packages. GitHub currently requires a classic token for
   private GHCR pulls. Do not add `repo`, `write:packages`, or
   `delete:packages`. Store it as a Dokploy/server credential readable only by
   the pull client that needs it; do not expose it to GitHub Actions or the
   observation verifier. Package visibility/access must be reviewed before the
   token is installed.
3. **Trusted-clock gate.** Install and enable `chronyd` from the VPS operating-
   system repository with at least three owner-approved NTP sources. Only root
   may change its configuration or system time. Before evaluating `issued_at`
   and `expires_at`, the verifier must fail unless `chronyc tracking` reports a
   real reference, `Leap status: Normal`, a recent reference time, and a
   configured maximum error bound computed from system offset, root dispersion,
   and half root delay. Recheck immediately before the first side effect. Record
   only sanitized clock status and the bound in evidence. The verifier service
   receives no `CAP_SYS_TIME`; its systemd unit uses `ProtectClock=yes`.
4. **Root-owned source policy.** Install a reviewed canonical policy file at
   `/etc/barber-staging-broker/release-policy.json`, owned `root:root`, mode
   `0644`, with its parent directory `0755` and non-writable by the release
   account. It pins repository ID/name, environment/reviewer IDs, workflow path,
   the independently reviewed Git blob SHA and source SHA-256, branch/ref,
   origins, both GHCR repository names, envelope limits, migration-tree digest,
   latest migration ID, and accepted broker protocol version. A workflow source
   change requires an out-of-band reviewed root update and service restart; the
   service never learns an allowlist value from an envelope or API response.
5. **Independent replay ledgers.** Give the unprivileged observation service a
   private state directory `/var/lib/barber-staging-release/` owned by its
   dedicated account and mode `0700`. Separately create
   `/var/lib/barber-staging/ledger/` as `root:root` mode `0700` for the broker.
   Each process is the sole writer of its ledger. Records are canonical JSON
   lines with sequence number, prior-record hash, event, request ID, run and
   attempt, nonce, artifact ID, binding hash, commit/image/migration tuple,
   trusted timestamp, and result. Append under an exclusive lock with
   `O_APPEND|O_NOFOLLOW`, flush file and directory state, reject symlinks or
   unexpected ownership/mode/link count, and verify the full hash chain before
   every authorization. Rotation is a separately signed/root-recorded checkpoint,
   never truncation. Back up the root ledger off-VPS. A crash before a terminal
   record leaves the request non-retryable until owner review; it never repeats
   a side effect automatically.
6. **Constrained broker.** Install the independently reviewed fixed broker
   executable as `root:root` mode `0755` beneath `/usr/local/libexec/` and its
   policy/configuration as root-owned, non-writable files under
   `/etc/barber-staging-broker/`. Run it as a hardened root systemd service with
   an allowlisted executable/filesystem view and Unix socket
   `/run/barber-staging-broker.sock`, mode `0660`, owner
   `root:barber-staging-release`. Authenticate peer credentials. Permit only the
   versioned operations `status.inspect`, `backup.capture`, `migration.apply`,
   and `images.rollback`; never accept commands, executable paths, arbitrary
   filesystem paths, Docker arguments, database URLs, secret values, production
   identifiers, mutable tags, or bootstrap. The current broker remains
   `status.inspect`-only. Do not add the deployment account to the socket group
   until exact-image bootstrap, baseline, backup/restore, migration, runtime
   security, and owner-approval gates all pass.

The GitHub API requirements above follow the official
[workflow-run API](https://docs.github.com/en/rest/actions/workflow-runs),
[artifact API](https://docs.github.com/en/rest/actions/artifacts),
[repository-contents API](https://docs.github.com/en/rest/repos/contents), and
[deployment-environment API](https://docs.github.com/en/rest/deployments/environments).
The separate registry credential follows GitHub's
[Container registry authentication guidance](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry).
Clock acceptance uses the fields and error-bound definition documented by
[`chronyc tracking`](https://chrony-project.org/doc/4.4/chronyc.html).

### Smallest exact owner provisioning action (documentation only)

Do not reuse, export, or copy the owner's current interactive `gh` OAuth token.
It has broader `repo` and `workflow` scope and is not a server credential. When
the owner separately authorizes credential creation, provision exactly these two
independent identities; neither one grants deployment or broker access.

#### A. GitHub evidence reader

1. In GitHub **Settings → Developer settings → GitHub Apps**, create a private
   app named for the staging evidence reader. Disable webhooks and request no
   organization or account permissions.
2. Set repository permissions to only **Actions: Read**, **Contents: Read**, and
   **Attestations: Read**. GitHub grants **Metadata: Read** implicitly. Leave
   Administration, Checks, Deployments, Environments write, Issues, Packages,
   Pull requests, Secrets, and Workflows without access.
3. Install the app only on account `malabdullah`, selecting **Only select
   repositories**, and select only `barberplusplus`. Record the numeric app ID
   and installation ID; these are identifiers, not secrets.
4. Generate one app private key. Transfer it directly to the VPS through the
   owner's encrypted administrative channel; never paste it into Codex, chat,
   GitHub Actions, Dokploy environment text, shell history, or the repository.
5. Encrypt it into the root-owned systemd credential store as
   `/etc/credstore.encrypted/barber-staging-github-app-key.cred`, owner
   `root:root`, mode `0600`. The future observation unit references it as
   `LoadCredentialEncrypted=github-app-private-key.pem:/etc/credstore.encrypted/barber-staging-github-app-key.cred`.
   Put only the non-secret IDs in root-owned configuration using the exact names
   `BARBER_GITHUB_APP_ID` and `BARBER_GITHUB_INSTALLATION_ID`.
6. The observation service mints a short-lived installation token in memory and
   exposes it only to its `gh api` subprocess as `GH_TOKEN`. It never persists,
   prints, forwards, or shares that token with Dokploy. Before enabling polling,
   prove the six allowlisted GETs work and record the app installation and
   permission screen. Do not test permissions by attempting a write.

No GitHub repository or environment secret is needed for this reader. The key
and IDs are VPS-local; PR and release workflows never receive them.

#### B. GHCR package reader

1. Use a separate owner-controlled GitHub machine account dedicated to package
   pulling; it must not own source, administer the repository, or hold the app
   private key. Enable the account's required security controls before access.
2. In each package's settings, grant that machine account **Read** access to
   exactly `malabdullah/barberplusplus` and
   `malabdullah/barberplusplus-functions`. Grant no Write or Admin package role.
3. While signed in as that machine account, create one personal access token
   (classic) with only `read:packages`. Do not select `repo`, `workflow`,
   `write:packages`, or `delete:packages`. Use the shortest practical expiry and
   record the owner and rotation date outside the repository.
4. Enter the machine account login under the exact secret name
   `GHCR_PULL_USERNAME` and the token under `GHCR_PULL_TOKEN` in the staging
   Dokploy registry/server credential store. Enter values only in that secret
   UI or a root-only systemd credential if the reviewed pull verifier later
   needs authenticated manifest reads. Never add these values to repository,
   environment, Actions, PR, or production secrets.
5. After a reviewed image has actually been published, verify read-only access
   by resolving each allowlisted repository at its full immutable
   `sha256:<64-lowercase-hex>` digest. Do not test by pushing a tag. A missing
   digest, `401`, or `403` remains a blocked result.

The identities stay separated: the GitHub App cannot read GHCR packages, and
the package account/token cannot read Actions evidence. Provisioning either
identity does not set `STAGING_VPS_AUTOMATION_READY`, add the release account to
`barber-staging-release`, enable broker mutations, approve a GitHub environment,
publish an image, or authorize first bootstrap.

The approved initial staging inventory for future adapter allowlists is exactly
Dokploy, PostgreSQL, gateway, Auth, REST, Realtime, Storage, compiled Functions,
and mail sink. Studio, postgres-meta, Supavisor, and imgproxy/image resizing are
intentionally excluded.

## Proposed adapter paths

### First provisioning (separate gate)

The first creation of the currently absent staging stack is bootstrap, not a
normal release. It requires an explicit owner-approved bootstrap plan, empty
Database/Storage/Vault proof, isolated resource and hostname checks, baseline
and migration verification, initial fixture approval, and a post-bootstrap
backup plus restore rehearsal. It must not invent prior-backup evidence for a
stack that did not exist. `STAGING_VPS_AUTOMATION_READY` remains false until
bootstrap evidence and the first accepted release are independently recorded.

### `scripts/staging-vps-backup-adapter.sh`

The adapter must quiesce the isolated staging workload and capture Database,
Auth, Vault, Storage objects, encrypted runtime configuration, and the complete
PostgreSQL `db-config` volume. The latter includes
`/etc/postgresql-custom/pgsodium_root.key`; `VAULT_ENC_KEY` or a database dump
alone cannot restore Vault. The `db-config` archive must be encrypted separately,
bound to the same release evidence, and restored before the target PostgreSQL
service starts. Its evidence records the release identifiers, migration-tree
hash, component checksums and sizes, capture time, encrypted off-VPS receipt
confirmation, root-key-volume restoration order, and successful Vault-inclusive
restore-rehearsal evidence reference. It returns success only after every
component, off-VPS receipt, and restore verification passes.

Storage backup and extraction must use a reviewed pinned GNU tar implementation
with `--xattrs`, `--xattrs-include=user.*`, `--acls`, and `--numeric-owner` while
the relevant services are stopped. A plain file copy is invalid because it can
lose the file-backend content-type, cache-control, ETag, ownership, and related
extended attributes. Recovery evidence must verify private object bytes and
metadata through the Storage API, including expected content type, cache-control,
ETag behavior, authenticated access, and anonymous denial. Capture and restore
must use isolated internal networks, no published restore ports, and newly
created labeled target volumes.

An encrypted transfer by itself is not a verified backup. Existing probe/pull
helpers and a successful synthetic local restore do not satisfy live VPS backup
acceptance; live evidence remains a separate gate.

### `scripts/staging-vps-migration-adapter.sh`

The adapter verifies applied migration history and the approved baseline,
records an exact dry-run, and then applies only the reviewed release migrations
with `--skip-vault`. It must never reset or seed a nonempty environment. Evidence
records before/after migration-tree hashes, dry-run checksum, applied migration
names, command outcome, and completion time. It refuses to run unless verified
backup evidence for the same release and image digests is supplied through
`BACKUP_EVIDENCE`.

### `scripts/staging-vps-rollback-adapter.sh`

The adapter restores the retained previous immutable frontend and Functions
digests through Dokploy and verifies their health. It never runs a destructive
database downgrade. Database failures require a reviewed forward fix or the
separate recovery procedure using verified backup evidence. Its evidence records
the rejected and restored digests, health results, timestamps, and any explicit
recovery-evidence reference.

## Review and activation gates

Before these proposed names become workflow dependencies:

1. Env3 implements and locally validates the adapters and JSON schemas.
2. A reviewed root-owned constrained broker provides only the exact privileged
   staging operations required by the adapters; its API, allowlists, ownership,
   and audit output are tested independently.
3. The isolated live stack passes backup, restore, migration, and recovery
   rehearsal without production data or credentials.
4. Every pinned AMD64 runtime image passes the approved security threshold; any
   unresolved High or Critical finding keeps the stack blocked.
5. The owner reviews the implementation and a separate first-bootstrap plan.
6. A dedicated Dokploy identity/token is limited to the Barber++ staging project
   and only application/compose read, update, and deploy operations.
7. The server-side deployment identity has no Docker-group or sudo privilege.
   No self-hosted runner is registered to the current public repository. A
   future organization workflow-restricted group or private deployment
   repository requires separate approval.
8. `STAGING_VPS_AUTOMATION_READY` is set to `true` only after all evidence is
   recorded. Environment approval is still required for each release.
