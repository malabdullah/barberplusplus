# Env3 completion record — October 5, 2026

Status: **NOT COMPLETE / no live VPS application release accepted**.
This record is a dependency-ordered work list, not permission to deploy.

## Latest: private backend bootstrap passed

The owner approved the exact private-bootstrap plan at `c24f8ec`. The permanent
eight-service private backend is now running, four migrations and synthetic seed
passed, and its real encrypted backup was copied to the Mac and restored into a
separate eight-service stack. A bounded 300-request probe passed without errors.
See [execution, receipts and remaining gates](staging-private-bootstrap-execution.md).
No public frontend/VPS release or full Env3 acceptance follows. The rehearsal
and pre-bootstrap observations below are historical, not the current inventory.

## Verified before bootstrap

- Staging SSH reaches `srv1207055` (`185.97.146.8`); production is not accessed.
- Existing services remain running. Before rehearsal, the host reported 5.6 GB
  available RAM and 60 GB disk free. This is headroom, not a load-test result.
- The GitHub evidence-reader App and the new existing-account package PAT are
  installed in separate encrypted, root-only credential files. Account, scope
  and expiry checks passed. See [credential evidence](staging-github-access.md).
- Neither named application package was found by GitHub's authenticated package
  API. Registry authentication is not evidence of an actual image pull.
- Full local `npm run check` passed; 107 staging safety tests passed separately.
  The preserved local synthetic database passed all 15 Playwright checks
  (five journeys repeated three times), with no reset. Existing bundle-size and
  mixed static/dynamic-import warnings remain; these are not a load-test result.
- PR3 remains draft/open on `codex/staging-vps`, head
  `c0d07027a48696077a125af584a36fb7827f488a`, with all five GitHub checks passing.
  Live `main` settings still require the five checks, strict updates and PRs,
  enforce administrators and block force pushes/deletion, with zero required
  second-person approvals. Staging still requires owner `malabdullah` approval,
  permits self-review and allows protected branches only. No protection changed.
- The owner explicitly authorized sending non-secret status to Env4. Both the
  app's cross-chat MCP tool and its legacy alternative were unavailable, so no
  message was delivered. No credential values were included in attempted messages.

## Gate sequence (updated after private bootstrap)

1. **Native compatibility and core recovery rehearsal — passed.** Used only exact reviewed
   candidate images, fresh randomly named synthetic volumes, internal networks
   and no published ports. Verify migrations, 32 pgTAP checks, Auth, REST/RLS,
   private Storage, Mailpit, Functions, Realtime and encrypted recovery. Existing
   services and live/production data must remain untouched. The current harness
   tests eight services, then restores the five-service core; report those
   separately, not as a full eight-service recovery proof.
2. **Release artifacts and source review.** Resolve image provenance and security
   findings, finish reviewed VPS workflow/consumer integration with Env4, publish
   exact source-bound images through approved CI, and verify private digest pulls
   using the new token. Never run the legacy Mac-targeted deployment as a VPS
   release. Keep `STAGING_VPS_AUTOMATION_READY` false.
3. **First-bootstrap plan and owner approval — passed at `c24f8ec`.** The owner approved
   the exact commit/image manifest and eight-service resource plan. Scope: new staging-only
   containers/volumes, independent generated credentials, validated baseline and
   randomized synthetic fixtures, sink-only email, outbound AI/WhatsApp disabled
   until dedicated integration checks pass. No deletion of legacy services,
   production changes, public DB/management ports, or implicit DNS cutover.
   The owner specifically approved this plan; general persistence instructions
   and credential approval did not substitute for that authorization.
4. **Bootstrap and recoverability — passed.** Prove the new target is empty, initialize
   the approved baseline once, and seed only synthetic data. Capture Database,
   Auth, Vault including db-config root key, Storage bytes/metadata and encrypted
   runtime config. Pull encrypted archives to the approved Mac destination and
   restore into different fresh volumes. All eight services passed that real
   recovery check; a transport-only fixture was not used to satisfy this gate.
5. **Staging ingress and integrations.** Route only the staging hostnames;
   verify TLS, Cloudflare Access default-deny and service access, and only the
   exact two Meta paths as exceptions with valid signatures/secrets/encryption.
   Verify isolated Meta/Flow/OpenAI credentials and recipient allowlists before
   bounded test communications. Never reuse production or contact real customers.
6. **Acceptance and handoff.** Run live smoke, role/tenant E2E, headers, isolation,
   outbound-denial and resource/load tests. Record the source, immutable images,
   migration tree, CI/environment approval, backup/restore receipts and defects.
   Do not claim Env3 complete while a required gate remains unverified.

## Security conditions retained

The existing Realtime exception is restricted to the exact reviewed candidate
and runtime profile, synthetic-only staging, and review by October 18, 2026 at
00:00 UTC. It is not a new deployment approval or a blanket scanner exception.
No production authorization follows from this work.

## Native rehearsal preparation

New root-private scratch directory on staging:
`/tmp/barber-native-core.bcwPRko1`.
Source snapshot: `c0d07027a48696077a125af584a36fb7827f488a` (committed files only).
Pinned upstream: `self-hosted/v0.8.0`,
`241bb11c0627f2981746d37033f57dbfa81d29b0`; its tag-to-commit and generated
minimal gateway configuration checks passed during scratch preparation.
Node 24.20.0 is extracted from the existing repository-pinned image into this
scratch directory only; no global Node installation or service was added.
The temporary extraction container was removed. No rehearsal success is claimed
by preparation alone.

The transfer exposed a test-harness portability issue: a single-platform Docker
export retains the reviewed AMD64 manifest but not its original local OCI
wrapper ID. The explicit `--exported-security-core-candidates` option preserves
the default Mac mode and selects only the exact previously-reviewed platform
IDs for native exported artifacts. Identity/platform/provenance/profile negative
checks remain enforced. This is a test-only compatibility change, not a changed
runtime image or deployment allowlist.

## Native rehearsal result

The final run completed October 5 at 04:46:06 UTC on `srv1207055`, exit 0.
[Machine-readable receipt](../ops/staging-vps/native-rehearsal-2026-10-05.json)
binds the base commit, exact changed source hashes and sanitized output hash.
All eight services passed their functional/isolation checks, including booking
UPDATE delivery, authenticated cross-tenant filtering, signed Meta paths,
encrypted Flow and disabled outbound. Four migrations and 32 pgTAP checks passed.
The separate five-service fresh-volume restore passed Auth, RLS, Vault decryption,
Storage content/metadata and encrypted-archive tamper rejection. No live backup,
eight-service recovery, public routing, frontend/browser or load acceptance follows.

Two initial failures exposed native Linux mount permissions hidden by Docker
Desktop: the private installer umask made SQL files and newly written public
gateway templates mode 0600. Non-root PostgreSQL readability was directly tested
before and after the bounded fix. The first corrected run passed the entire core
but failed gateway startup; the final run passed both. Only the seven known public
SQL files become 0644. Public gateway sources are exclusively created and chmodded
through their open descriptor; parent directories remain private and secret files
are unchanged. Tests cover private umask, existing files, symlinks and missing SQL.
Full local `npm run check` passed again with these fixes.

The rehearsal cleaned only its labelled synthetic containers, networks and volumes.
The existing running-service inventory before/after matched exactly. A follow-up
check confirmed no core-probe containers and no `/opt/barber-staging/supabase`
installation. The previously transferred images remain cached for reviewed future
work. Production, DNS, Cloudflare and deployment approvals were untouched.

A separate AI code-review pass checked the exported-image identity constraints,
private-umask fixes, exclusive file creation, permission boundaries, negative
tests and no changes to deployment image pins. No additional actionable finding
was identified; this is not independent human review. The proposed
[first permanent bootstrap plan](staging-first-bootstrap-plan.md) binds exact
candidate images, isolation, synthetic data, preserved legacy resources and
security limitations. Its specific owner approval remains required before any
permanent stack is created. Frontend publication and public cutover are excluded.

GitHub run `37265245228` identified the literal, non-secret permission-test fixture
as a generic API key. The fixture is now comment-only. Only that exact historical
commit/path/line fingerprint is recorded in `.gitleaksignore`, preserving history
without disabling a rule or scanning exemption for current files. New CI must
pass independently; the earlier run is not reported as successful.
