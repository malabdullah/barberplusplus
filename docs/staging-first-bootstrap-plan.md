# First permanent staging bootstrap — owner approval required

Status: the owner approved this plan at commit
`c24f8ecadbe49d353965a0e9b457ebcd3cfca287` on October 5, 2026 with
“Approve this private staging bootstrap.” The private backend is initialized,
functionally verified and recovered into separate disposable volumes.
See the [execution and remaining gates](staging-private-bootstrap-execution.md).
This is a one-time backend bootstrap, not a frontend release or Env3 acceptance.
Approval must identify the exact Git commit containing this plan. Changed images,
profiles, source, scope or expired risk acceptance require a new review.

## Exact target and permitted resources

- Hostinger `srv1207055`, `185.97.146.8`, existing approved 2-vCPU/8-GB VPS;
  no purchase or resize. Production `srv1073968` is excluded.
- New private root-owned installation `/opt/barber-staging/supabase` only if absent.
  Refuse collisions with any existing container, network, volume or configuration.
- Eight services under a new staging-only Compose project: database, API gateway,
  Auth, REST, Realtime, Storage, compiled Functions and Mailpit.
- New exclusively owned database data, database configuration/Vault-root-key and
  Storage volumes; no reused volumes or imported user/customer data.
- Internal-only networking initially, no published host ports, no production
  connections, no DNS/TLS/Cloudflare cutover in this bootstrap authorization.
- Preserve Dokploy, n8n, Ollama and every existing service/data volume. Do not
  delete old stacks as an incidental cleanup step.

## Exact reviewed native AMD64 candidate set

The five local IDs below name imported, identity-checked platform manifests;
they are not GHCR publication or signed provenance claims. Use pull policy
`never` for them and refuse missing/mismatched content. Do not rebuild or replace
an image to satisfy this plan. Official images remain digest-pinned.

| Service | Exact image reference |
| --- | --- |
| Database | `sha256:b8aebc0a7bdcfd3eadc557f0d19999ee5f5d4a29590e03ba34d90acf783cbd92` |
| Auth | `sha256:aa5adadc5b0e338b64d2d4565c6f7820989f778cb9e89895b1c4a07ed079302d` |
| Storage | `sha256:ffc760ae7a04b0790ba3988c31916a586790db88b66f53d7f307dfe297231613` |
| Functions | `sha256:4304bfb208a54190aab7347dfe83c362efb7feb88f40ddd99d85c227b31e2c16` |
| Realtime | `sha256:78f25384ba6173d08f4dd7969989f5115d986cf4e8923f7906bf4fa00bfd1902` |
| REST | `postgrest/postgrest@sha256:c847127074bd26e1b8d3f7c0e6e01e5346f4b85dd34f5d699fd230af960827c0` |
| Gateway | `envoyproxy/envoy@sha256:43b69cf424922cd5d1086cc019dc89197e58d58deac89d36b3c8b67f1a9e8523` |
| Mailpit | `axllent/mailpit@sha256:ed9b00c609e77e99c79b93f1178255ebc271868920f2c69a8d166bd5634ed10d` |

Upstream initialization files remain bound to Supabase commit
`241bb11c0627f2981746d37033f57dbfa81d29b0` (`self-hosted/v0.8.0`).
The existing Compose deployment pins do **not** select this candidate set; a
separate reviewed installer/rendered manifest is required. Never run the old
deployment configuration unchanged or relabel test success as live acceptance.

## Mandatory safeguards and limitations

1. Verify architecture/content metadata, approved source checksums and the
   baseline readiness marker before initializing anything. Render and review the
   complete service configuration without printing secrets. Reject unexpected
   mounts, services, privileges, public ports or networks.
2. Retain the exact Realtime profile SHA-256
   `a991dccc40ca64c42d03cbf7b0ecf9d17b1174eb585a73934367f6f407cb3c9a`.
   Functions and gateway run non-root/read-only with dropped capabilities and
   no-new-privileges, as rehearsed. Native Realtime gets no ARM-emulation flag.
3. Generate separate staging Auth/JWT, database, Vault, runtime and synthetic-test
   secrets. Never copy development/production credentials. Protect persisted
   secrets root-only, encrypt backup copies, and keep them out of Git/logs/arguments.
4. Prove the new database is empty before replaying the exact four timestamped
   migrations and randomized synthetic fixtures. Abort on existing application
   data, unexpected migration history, Vault entries or repeated seeding.
5. Sink-only Mailpit accepts only `@barber.test`. Disable signup/phone/anonymous
   auth and telemetry. Keep AI/WhatsApp tokens empty, AI outbound false and
   recipient allowlist empty. Synthetic Meta/Flow keys are test-only until a
   separate dedicated integration validation replaces them.
6. Verify health and the same native functional/security checks. Capture an
   encrypted complete-runtime backup including Vault root-key/config and Storage,
   copy to the approved Mac backup destination, and test restoration into fresh
   different volumes. The passed five-service fixture restore does not waive this.
7. On failure, stop only newly created, ownership-verified staging resources.
   Retain volumes/configuration/evidence for diagnosis; do not automatically erase
   a permanent database. No production rollback or existing-service restart.

## Security decision the owner is approving

These are maintained downstream staging images, not unmodified vendor releases.
The Auth scan retains one HIGH version match; the exact downstream decoder patch
and regression/fuzz evidence address that reported crash path, without claiming
a clean scan or complete audit. Realtime retains 52 HIGH package matches across
12 advisories and zero CRITICAL findings. Its previously approved restricted
synthetic-staging exception remains unchanged and expires for review on
October 18, 2026 at 00:00 UTC; it is not renewed here. Raw findings remain visible.
Other recorded zero-HIGH/CRITICAL results have limited scanner coverage, not a
guarantee of no vulnerabilities. See the component security inventory and the
Realtime assessment/owner-acceptance records for exact evidence and conditions.

This approval does not authorize public exposure, PR merge, a GitHub environment
approval, frontend release, publication/visibility changes, enabling the release
broker, removing CI gates, paid integrations, production changes or declaring
Env3 complete. Those later gates remain required.
