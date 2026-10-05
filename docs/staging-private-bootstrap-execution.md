# Private staging bootstrap — October 5, 2026

**Private backend running and recovery verified; Env3 NOT complete.**
This records the owner's specific approval of the plan at
`c24f8ecadbe49d353965a0e9b457ebcd3cfca287`:
“Approve this private staging bootstrap.” It does not authorize public exposure,
frontend release, PR merge, GitHub environment approval or production changes.
All five source CI jobs passed in GitHub run `37265346444` before initialization.

## Created resources

Only `srv1207055` (`185.97.146.8`) was used. Installation:
`/opt/barber-staging/supabase`, root-owned 0700. Compose project and internal
network: `barber-staging-private`. Its eight container suffixes are `db`, `auth`,
`rest`, `storage`, `mailpit`, `realtime`, `functions`, `api-gw`.
New exclusive volumes: `barber-staging-private-data`,
`barber-staging-private-config` (including the Vault root key), and
`barber-staging-private-storage`. Ownership label:
`cloud.malabdullah.barber.private-bootstrap=c24f8ecadbe49d353965a0e9b457ebcd3cfca287`.

Images and upstream SQL/gateway files are exactly those in the approved plan;
no application source, migration, image or Realtime profile was replaced.
Operator additions implement that one-time plan and have separate source hashes.
The operator source is retained root-private at
`/opt/barber-staging/supabase/operator`; its pinned Node 24.20.0 binary is
`/opt/barber-staging/supabase/tools/node` (SHA-256
`89af8424dd53e560b1933f87ba650d8bf57c83ca5a04600eefb31f416aabbae7`).
Neither needs a temporary directory or a global Node installation to run.
The initialization operator SHA-256 was
`06685201b25b503588f3f18eb3f605f44eabc729495945f73fb1817895be78e7`;
the private model SHA-256 was
`4cd4a6673d5ef33b05279b4150951a10076bff460f3462fb19bb1f7ab9987671`.

No published ports, external Docker network, DNS changes or public cutover.
Existing Dokploy, n8n, Ollama and Traefik container identities/images were
unchanged. Production was not accessed. No existing services or data were deleted.
Only labelled disposable restore resources were removed after successful testing;
their synthetic state remains recoverable from the encrypted backup.

## Verification

- Initialized at 05:08:31 UTC after empty-target, image/configuration checksum and
  baseline-readiness gates. Four exact migrations and 32 pgTAP assertions passed.
- New independent database/JWT/Vault/runtime credentials and randomized synthetic
  accounts; no production or development secrets/data imported. Service/anonymous
  JWT expiry is January 3, 2027 at 05:05:25 UTC; session lifetime is one hour.
- Functional checks passed at 05:10:47 UTC: login, REST/RLS, private Storage,
  sink-only email, gateway boundaries/CORS, function JWT/cron/Meta checks,
  encrypted Flow, Realtime broadcast and booking events with cross-tenant denial.
  Temporary Realtime test policies were removed.
- Signup, phone/anonymous login, telemetry and scheduled jobs disabled. Mailpit
  accepts only `@barber.test`. AI/WhatsApp tokens and recipient allowlist remain
  empty; AI outbound is false; internal networking has no default egress route.
- A 30-second read-only probe passed at 05:22:49 UTC: five concurrent clients,
  target ten requests/second, 300 requests, zero errors, p95 144 ms, max 270 ms,
  no restarts/OOM. This is NOT full capacity or frontend/browser acceptance.

[Sanitized execution receipts](../ops/staging-vps/private-bootstrap-evidence-2026-10-05.json)
are public-safe. Do not print `compose.private.json`, synthetic account/integration
files, seed SQL or decrypted archives: they contain credentials.

The final local `npm run check` passed, including 148 staging safety tests;
all 15 Playwright journeys passed (five journeys repeated three times) against
the preserved development database, without a reset. A separate AI review pass
checked resource ownership, source/image bindings, failure stops, no-overwrite
markers, secret handling and disposable-restore cleanup. This was not independent
human review. Existing bundle-size and mixed-import warnings remain. These local
browser checks are not public VPS frontend acceptance.

## Real backup and full restore

Backup `staging-20261005T051540Z-c0240e7a`, ciphertext 1,188,328 bytes, SHA-256
`774f8c9d702c9f66b25df34bd26071907a6b4c0987eac533a24ead2259058dec`.
This is a real private-backend backup, not the earlier transport fixture.
All application writers were stopped briefly; the logical DB dump, Storage
bytes/metadata and Vault configuration were captured consistently with encrypted
runtime configuration. All eight permanent services resumed successfully.

The encrypted export is retained under
`/var/backups/barber-staging/export/staging-20261005T051540Z-c0240e7a` and copied to
`/Users/malabdullah/BarberBackups/staging/staging-20261005T051540Z-c0240e7a`.
The Mac verified ciphertext size/hash and authenticated full age decryption.
The private decryption identity never left the Mac.

At 05:20:19 UTC, all eight services restored into fresh isolated volumes passed
Auth, RLS, Vault decryption, Storage bytes/content types, SMTP capture, gateway,
Functions/Flow and Realtime/tenant checks. The source had six synthetic Auth
users (including an invitation), two branches, two Storage objects, four
migrations and one synthetic Vault recovery probe. Live volumes were not
overwritten. The disposable restore stack/network/volumes were removed.
`restore-receipt.json` is retained beside the Mac backup; the historical transport
receipt deliberately remains transport-only rather than being relabelled.

Mailpit's tmpfs inbox, active Realtime connections/cache and Functions tmpfs are
ephemeral and excluded. Candidate images remain cached on the VPS and Mac;
registry publication/pull and lost-host recovery availability are not yet proven.
The capture operator is one-time, requires an initially empty Vault and must not
be rerun as a scheduled backup. Bootstrap/functional/load operators also have
exclusive markers; do not delete markers to force retries. A reviewed recurring
backup adapter, freshness monitoring, retention and key rotation remain pending.

## Outstanding release gates

1. Review and publish source-bound immutable frontend/Functions/component
   artifacts through CI; prove restricted registry pulls. Adapt the VPS release
   consumer with Env4; automation remains disabled and the broker inspect-only.
2. Approve and apply a precise management-access hardening plan. UFW was inactive
   and Dokploy port 3000 host-published. One external connection timeout is not a
   complete firewall audit. Existing service/firewall changes are not authorized
   by this private-bootstrap approval.
3. Obtain specific frontend release and staging-only ingress approval; configure
   TLS/Cloudflare Access default-deny with only the exact signed Meta paths public.
   Existing public staging addresses still target the earlier Mac lab, not this
   private backend. Do not invoke the old workflow as a VPS release.
4. Validate dedicated Meta/Flow/model credentials and allowlisted test recipients
   before any external communication; synthetic signature tests are not proof of
   a real provider integration. No paid integration is enabled here.
5. Run live frontend/browser/role/security-header/outbound/isolation acceptance,
   realistic resource/load tests and recovery freshness checks, then record owner
   acceptance of the exact release. The approved two-core initial-test exception
   is not a capacity acceptance.

Auth retains its documented HIGH version match and reviewed downstream decoder
patch. Realtime retains 52 HIGH matches across 12 advisories, zero CRITICAL;
the exact restricted synthetic-staging exception still requires review by
October 18, 2026 at 00:00 UTC. Neither this bootstrap nor recovery renews that
exception or establishes a clean scan. See the component security inventory.
