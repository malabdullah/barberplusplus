# Restricted staging GitHub access

October 8 update: the existing encrypted App key is now wired only to the
owner-approved **manual, read-only** observer through systemd credentials.
Live runs verified the exact App/repository/read scopes and token revocation,
and, after the approved clock adjustment, rejected the expired release envelope.
No timer, polling, package-reader
credential delivery or deployment capability was added. See
[installed observer receipt](staging-manual-observer.md).

## October 5, 2026 — partial provisioning, not deployment authorization

Later October 5 update: after the approved merge/build, a read-only VPS probe
using the existing package credential verified both package metadata responses
(HTTP 200), repository ID `1123713308`, and exact manifest bytes. Both packages
are public; the owner explicitly approved keeping the code packages public and
staging access private. No visibility or credential scope changed. Anonymous
manifest/signature verification also passed after the OCI-index reader fix.
See [publication evidence](staging-first-image-publication.md). The earlier 404
probe below is historical. No image was deployed and no polling service enabled.

The owner approved the restricted evidence-reader and a separate package-reader
credential. On October 5 the owner explicitly chose to use the existing
`malabdullah` account for package downloads instead of creating a machine
account. This does not authorize merge, bootstrap, environment approval,
production access, or broker mutations. Never copy the owner's interactive
GitHub CLI token to the VPS.

### Evidence-reader app

- Owner: `malabdullah`.
- App: `Barber Staging Evidence Reader` (`barber-staging-evidence-reader`).
- App ID: `5185797`.
- Repository permissions verified in GitHub: Actions, Contents, Attestations
  read-only, plus mandatory Metadata read-only; no other selected permissions.
- Webhooks, user OAuth during installation and device flow are disabled.
- Installation ID: `167815503`. The owner completed installation; both the
  installed settings page and the authenticated VPS probe verified selected
  repository access to only `malabdullah/barberplusplus` (ID `1123713308`).
- The owner generated and downloaded one private key. Its public fingerprint
  matches GitHub: `SHA256:H9oQjcbGCsUbaICrFtkBurPtqb72tN2uCZBbSdZfX5k=`.

### Credential custody

The downloaded PEM was restricted to mode `0600` on the owner's Mac. Its bytes
were streamed over host-key-verified SSH to staging only (`srv1207055`), directly
into `systemd-creds encrypt`. No plaintext key file was created on the VPS.

- Encrypted credential:
  `/etc/credstore.encrypted/barber-staging-github-app-key.cred`.
- Owner/mode: `root:root`, `0600`; parent directory `0700`.
- Embedded systemd credential name: `github-app-private-key.pem`.
- Encryption: host key, AES-256-GCM per the installed systemd documentation.
- New host encryption key: `/var/lib/systemd/credential.secret`, `root:root`,
  `0400`. It is on an **unencrypted filesystem**. Host-key encryption does not
  protect against root compromise or an attacker obtaining both files.
- Verification decrypted only into a pipe, derived the public-key fingerprint,
  and compared it with GitHub before atomically creating the final credential.
- The original downloaded file remains on the Mac; it has not been claimed as
  an encrypted/off-device recovery copy.
- Non-secret `BARBER_GITHUB_APP_ID` and `BARBER_GITHUB_INSTALLATION_ID` are saved
  in `/etc/barber-staging-evidence-reader/identity.env`, verified `root:root`
  mode `0600`, with the new parent directory mode `0700`. No unit was enabled.

### October 5 VPS credential probe

The one-shot probe ran on `srv1207055`, using the encrypted credential above.
It verified installation owner `malabdullah` (ID `19295903`), app/installation
IDs, selected-repository mode, non-suspended state, and exactly the four read
permissions. A short-lived installation token was explicitly limited to
repository ID `1123713308`; its permissions and single-repository listing
matched. Neither the private key, JWT nor installation token was printed,
persisted to a plaintext VPS file, or placed in command arguments. Decryption
used anonymous memory, subprocess pipes and disabled core dumps.

| Read capability | Result |
| --- | --- |
| Workflow run `37201022910` | HTTP 200; commit `c0d07027a48696077a125af584a36fb7827f488a` |
| Run approval history | HTTP 200; empty array, **not approval** |
| Staging environment | HTTP 200; ID `21158713380` |
| Artifact `11302714471` | HTTP 200; `gitleaks-results.sarif`, **not release evidence** |
| Staging workflow at the commit | HTTP 200; Git blob `77a67514646af4f4b90d4fcfd6849ec09221d68c` |
| Artifact archive endpoint | HTTP 302; signed redirect neither printed nor followed |

This proves API permission/transport access, not a downloaded and verified
release artifact, attestation, environment approval, policy acceptance, or
deployment authorization. The production collector must still reject this
non-release SARIF artifact. No write-denial probes were attempted.

The temporary token was revoked immediately after the probe (HTTP 204).
The probe followed GitHub's [JWT guidance](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app)
and [installation-token API](https://docs.github.com/en/rest/apps/apps#create-an-installation-access-token-for-an-app).
Observation-service integration, hardened token renewal, eligible release
artifact/download validation and attestation checks are still outstanding.
No observation service, polling or deployment access was enabled.

### Package reader — existing-account plan approved October 5

Installed and verified on the VPS October 5. The owner explicitly requested continuing without another
GitHub account after the wider package-read scope was explained. This supersedes
the separate machine-account requirement only; the solo-owner PR/release review
policy is a different control and is unchanged.

- Account: existing `malabdullah`; credential: a **new**, staging-specific PAT
  (classic), named `barber-staging-ghcr-pull`, with only `read:packages`.
- Verified API expiry: `2026-11-04T04:09:50Z` (07:09:50 Kuwait time).
  Rotate before expiry; no automatic rotation or reminder is configured.
- Do not select `repo`, `workflow`, `write:packages`, `delete:packages`, or any
  administrative scope. Never reuse/export the interactive GitHub CLI token.
- GitHub classic PATs cannot restrict this scope to two individual packages.
  The credential may read other private packages the owner can access, including
  future packages. A local repository allowlist constrains normal operation but
  cannot prevent someone holding a stolen token from reading those packages.
- Staging consumers must still allow only `malabdullah/barberplusplus` and
  `malabdullah/barberplusplus-functions`, by reviewed immutable digest. No
  production consumer, public-visibility change, push, or delete is authorized.
- Keep the credential separate from the evidence-reader App key and GitHub
  Actions. Supply `GHCR_PULL_USERNAME` and `GHCR_PULL_TOKEN` only to the reviewed
  staging registry consumer through protected secret storage. Never paste the
  token into chat, repository files, command arguments, logs or Actions secrets.
- The generation form was verified to select only `read:packages`, with the
  label above and expiry November 4, 2026. The owner reported generating and
  saving it in Apple Passwords. A separate VPS API check verified account
  `malabdullah` (ID `19295903`), exactly `read:packages`, and the expiry above.
- The owner completed the one-shot hidden Terminal prompt, which validated the
  account and scope, then streamed the token over pinned SSH into
  `/etc/credstore.encrypted/barber-staging-ghcr-pull-token.cred` (embedded name
  `ghcr-pull-token`). A subsequent check confirmed `root:root` mode `0600`.
  The importer refused overwrites and plaintext token files, encrypted with the
  host key, and verified a decrypted in-memory round trip. The same host-key
  encryption limitations documented above apply. Token values were not shown
  in chat, process arguments, logs, or repository files.
- Verify exact token scopes and authenticated pulls before claiming readiness;
  a missing image or denied request remains a blocker.

#### Read-only package checks — October 5

| Package | GitHub package metadata | GHCR pull-token request |
| --- | --- | --- |
| `malabdullah/barberplusplus` | HTTP 404 | HTTP 200 |
| `malabdullah/barberplusplus-functions` | HTTP 404 | HTTP 200 |

The registry issued an authentication response for each requested pull scope;
that alone does **not** establish actual package access, manifest existence or
pull permission. Neither package was found by the authenticated metadata probe.
No immutable image was resolved or pulled. Publication/existence and actual
digest access remain unverified and block image acceptance. No package was
published, made public or deleted, and no deployment was started.

Only credential custody and account/scope/expiry validation are complete. The
credential is not yet connected to a Dokploy registry consumer or enabled
observation service. Release review/approval, exact-image publication and pull
tests, first-bootstrap approval, and live acceptance gates remain unchanged.

GitHub documents `read:packages` for downloads and requires a classic PAT for
this external registry authentication: [Container registry authentication](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry#authenticating-with-a-personal-access-token-classic).
