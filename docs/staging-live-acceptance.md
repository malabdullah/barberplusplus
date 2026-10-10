# Env3 live staging acceptance — October 8, 2026

**Decision: GO for the approved manual, private, synthetic-only staging sandbox.**
The exact application release is deployed on the isolated VPS and both staging
DNS records route to it through Cloudflare Access. The real-owner browser login
defect below was corrected with explicit owner approval and retested without
machine access headers. Full Env3 operational closure/owner acceptance, real
provider integrations, automatic backups/deployment, and production acceptance
remain separate. No production-promotable accepted-release manifest was generated.

## Exact deployment and authority

- Source `6217cb33bd9aaf32aa0fa924278f314988449f12`.
- Main CI `37747708348`; image publication `37748167638`, attempt 1.
- Frontend `ghcr.io/malabdullah/barberplusplus@sha256:4d656e8cf03535b14c7a1cd5d55c604e0bb172147777102d854ae6f329659aab`.
- Functions `ghcr.io/malabdullah/barberplusplus-functions@sha256:b748a2d51c78df994ff93e0e26066d8193d61032ee2c21cad75264c1f2bb4c35`.
- No new migrations, reset, reseed, or production access. Complete migration
  hashes are retained in the root-private origin receipt and bootstrap records.
- The owner approved this manual release and the two staging-domain cutover,
  then explicitly approved replacement of the two old DNS records after the
  Cloudflare form refused an in-place target edit.
- Recovery: encrypted backup `staging-20261008T091500Z-be276ae2`, verified
  off-host decryption, complete isolated restore and candidate-image rehearsal.
  See [execution and rollback evidence](staging-manual-first-launch.md).

## Passed checks and limits

`scripts/accept-manual-staging-live.mjs` passed at 10:36:11 UTC:

- Anonymous frontend, Auth, REST, Storage, Realtime and non-public Functions
  requests redirect to Access. Both Meta endpoint neighboring/trailing/encoded
  child paths remain protected.
- Authenticated HTTPS runtime identifies the exact release and staging API.
- CSP, frame denial, noindex, nosniff, referrer policy, runtime no-store and HTML
  no-cache match the reviewed Nginx configuration.
- Exact public Meta paths reject missing signatures; invalid challenge denied.
- Chromium at 1365×900 passed admin, manager, agent and barber login and
  unauthorized-workspace redirects. Manager sees only its synthetic branch;
  direct authenticated barber REST reads exclude the other tenant.
- **These browser tests injected Access service headers only on the exact two
  staging origins. They prove application behavior behind Access, not the real
  owner's cookie-only browser path. They are insufficient alone for acceptance.**

`scripts/accept-manual-staging-integrations.mjs` passed at 10:38:59 UTC:

- Both private Storage fixture contents recovered through the public gateway;
  anonymous Storage access denied.
- Hostile Origins and management routes denied.
- Synthetic signed webhook accepted; body tampering rejected. Signed plaintext
  Flow rejected; real RSA/AES encrypted ping decrypted correctly end to end.
- WhatsApp send function fails closed with missing test integration configuration;
  OpenAI key, WhatsApp token and allowlist remain empty, AI outbound flag false.
- WSS booking UPDATE delivered to the authorized barber, withheld from another
  authenticated tenant with its live connection confirmed. The original
  synthetic booking note was restored and verified, including failure cleanup.
- Thirty public REST reads, concurrency 3, zero errors, p95 1174 ms. This is a
  bounded smoke test, not full capacity or sustained-load acceptance.

After testing, all nine containers retained exact expected images, zero restart
counts, no OOM events and no published ports. Seven have healthy health checks;
Functions and API gateway are running and passed HTTP functional checks. Both
Docker networks remain internal. Cloudflared is active. VPS memory available
5069 MiB of 7940 MiB; disk 44% used (54 GiB available). These are point-in-time
observations, not uptime monitoring or a capacity guarantee.

## ENV3-LOGIN-01 — high severity, resolved and retested

Expected: an owner who signs into Cloudflare Access can use the app's normal
login without developer tools, machine credentials or custom request headers.

Actual: the owner browser successfully signed into Access and reached the
staging-branded login page. Submitting a deliberately invalid synthetic password
produced a browser `TypeError: Failed to fetch` from Supabase `signInWithPassword`;
the UI masks that transport error as “Invalid email or password.” No real
password was used for this diagnostic.

Cause evidence: frontend and Supabase are different origins; `src/lib/supabase.js`
uses the default fetch behavior, with no cross-origin cookie inclusion. The API
is independently protected by Access, and its gateway deliberately does not
enable credentialed cross-origin CORS. Service-header browser tests bypassed
this interaction. Cloudflare documents both the required API-host authorization
cookie and the unauthenticated preflight problem in its
[Access CORS guidance](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/cors/).

The following correction received explicit owner approval and was applied:

1. Keep both exact tested images and all Access rules unchanged.
2. Route only known API families on the frontend hostname to the same private
   gateway, ahead of the frontend catch-all: Auth, REST, Storage, Realtime and
   Functions `/v1` routes. Unknown/management paths must not gain API access.
3. Point frontend runtime Supabase HTTP/WSS URLs to that same frontend origin.
   Keep the separate API hostname and its exact public Meta paths intact.
4. Preserve old configuration, hashes and route order for rollback. No public
   port, external Docker network, frontend secret, Worker secret, CORS wildcard
   or new Access bypass is part of this correction. If the route UI unexpectedly
   requires another DNS deletion, stop and resolve that separately.
5. Retest actual cookie-only browser login, all roles, WSS, Storage, exact-path
   boundaries and frontend assets; distinguish it from service-token tests.

No Access credentials were embedded in JavaScript and the API was not made public.

### Correction execution and final results

At 10:49 UTC, `scripts/apply-staging-same-origin.mjs` changed only frontend bind
mounts to new versioned runtime/Nginx files and recreated that frontend using
the same digest. Backend and all other container identities stayed unchanged;
the frontend retained `172.22.0.2`, its internal network and zero published ports.
The root-owned frozen operator SHA-256 is
`77c70fe88b74a2d58ff840ba2b22bcca7159be70cc015f12cb183668fc1ec7a8`.
It remains at `/root/barber-manual-release.TeZmqs/scripts/apply-staging-same-origin.mjs`.

Current frontend model: `/opt/barber-staging/manual-first-release/frontend.same-origin.json`.
New files: `runtime-config.same-origin.js`, `nginx.same-origin.conf` in that same
protected directory. `same-origin-started.json` and `same-origin-verified.json`
record the switch. The latter deliberately records only operator health, not
the later browser acceptance documented here.

- Current runtime SHA-256: `9ae36ae923fb9fdc16a0b419860e2ac9a043d852ae8f50ce504b0942dbbb8308`.
- Current Nginx SHA-256: `64943af25bf4b32f66055c880f162ccde5063b73cdb28a6ba4e9a7bc30b24e32`.
- Previous runtime SHA-256: `3a66d726b920d6fbb5ddf264185995737544b4594e369b1df24c953f0aa11308`.
- Previous Nginx SHA-256: `09d47d733f15a08c0a0c4a7de54d93d32ed28d7c6724609bda7e78ca7d04e230`.

Cloudflare ordered routes, all on the new VPS tunnel:

1. `staging-barber.malabdullah.cloud`, path `^/(auth|rest|storage|realtime|functions)/v1(/.*)?$`
   → `http://172.21.0.5:8000`.
2. Same frontend hostname, all remaining paths → `http://172.22.0.2:8080`.
3. `supabase-staging.malabdullah.cloud`, all paths → `http://172.21.0.5:8000`.
4. Catch-all `http_status:404`.

Adding the path rule required no DNS replacement and changed no Access policy.
All API paths on the frontend hostname, including its Meta paths, require Access.
Only the two exact paths on the separate API hostname retain their existing
public signature-protected exceptions. No Auth/database/backend settings changed.

All automated public checks were rerun after the correction: role and boundary
suite passed at 10:51:27 UTC; same-host Storage/WSS and integration suite passed
at 10:51:51 UTC. The repeat bounded load had 30 requests, concurrency 3, zero
errors and p95 1960 ms, close to its 2000 ms smoke threshold. Do not infer spare
capacity or a service-level objective from this small network-dependent sample.

Separately, the owner's normal in-app browser used its existing Cloudflare login
and no injected service-token headers. Synthetic admin login reached `/admin`,
sign-out returned to login, synthetic barber login reached `/barber`, and trying
`/admin` as barber redirected to `/barber`. Thus the original transport defect
was retested in the path the owner will actually use. The temporary local test
password copy was removed; original VPS fixtures remain protected.

English/dark and Arabic/light admin views were exercised, with RTL direction and
no document-wide horizontal overflow verified. A 390×844 mobile RTL spot check
showed a navigation-drawer layout requiring further product visual QA; do not
count this as broad mobile/accessibility acceptance. The viewport and language/
theme were restored after the check. This app-layout follow-up is distinct from
the resolved deployment/login transport issue.

### Rollback

Retain all original files and both prior Compose variants. To reverse only the
runtime correction, restore `frontend.private-origin.json` with the same exact
image and validate the private IP; remove/reorder only the added frontend API
path rule. This returns the known two-origin login defect and is not a healthy
normal-user fallback. For complete release rollback, use the original Functions
model plus the prior DNS/Mac routing values in the manual-launch record; do not
restore over the DB or delete persistent volumes. Any rollback needs a recorded
reason, owner awareness and verification, not blind replay of one-shot scripts.

## Remaining operational scope

Normal-browser technical acceptance has passed. Final owner acceptance and
broader mobile/product QA remain. Production readiness remains a separate task.
Deployment automation and automatic backup scheduling are not complete or
enabled by this manual release. Real Meta/OpenAI provider calls remain disabled;
synthetic cryptography tests are not provider integration certification.

The existing Auth finding review and restricted Realtime exception still apply;
Realtime review deadline remains October 18 at 00:00 UTC. They were not renewed
or broadened. The two-core VPS approval covers initial bounded staging tests.

Evidence screenshots on the operator Mac: `/private/tmp/barber-staging-vps-live-routes.jpg`,
`/private/tmp/barber-staging-vps-live-dns.jpg`, `/private/tmp/barber-staging-live-login.jpg`.
Sanitized machine results: `/private/tmp/barber-staging-live-acceptance-20261008.json`
and `/private/tmp/barber-staging-integrations-20261008.json`. No secret values or
raw request traces are part of this record.

Final reports: `/private/tmp/barber-staging-same-origin-live-20261008.json` and
`/private/tmp/barber-staging-same-origin-integrations-20261008.json`.
Normal-browser screenshots: `/private/tmp/barber-staging-live-admin.jpg` and
`/private/tmp/barber-staging-live-barber.jpg`. The live browser is left in the
synthetic barber workspace, not an owner-wide infrastructure/admin session.
Final local verification: full `npm run check` and `git diff --check` passed;
existing bundle-size/dynamic-import warnings remain recorded, not silently fixed.
The deployment, Supabase and QA skills drove the distinction between service-token
tests and ordinary-browser acceptance; that additional check found and then
verified the correction of ENV3-LOGIN-01.

## Complete migration set (unchanged)

| Migration | SHA-256 |
| --- | --- |
| `20260901000000_baseline.sql` | `b901044d0b1d6d99e1a078938031163b58acd56040f7cc52353c392b9ca7cc14` |
| `20260901104047_self_hosted_cutover.sql` | `5d6758daeb28d8349062100ae2d486e15bb55db8e310430ae8546d443a45406b` |
| `20260902095726_trusted_authorization_and_cron.sql` | `49e3f92e35d88142e5a08909e868b1c24b4913b9bd309b357b77e2be881187aa` |
| `20260903111635_harden_authorization_and_service_policies.sql` | `1dcbb12039adefebd47d134e699131c75373d6a16fd4d8fda4721406f7f3e6df` |
