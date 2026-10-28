# Private disposable cloud profiles — candidate 0.1.0-candidate.1

Base main: `c82c6539ed1fd2db6eb39bd0dd7c7569bc938877`. Test and Staging are separate profiles in **one private cloud workspace**, not separate cloud security tenants. They have separate DB/Auth signing and API keys, Storage roots, config, service metadata, ports and frontend builds. Native compatibility is not exact deployed-image parity or production-release acceptance. Root owns the production handoff/provenance documentation; no workflow is changed here.

## Prerequisites and clean provisioning

The tested host is Linux x86_64/glibc, non-root, Python3.12+, Bash, curl, openssl, tar/zstd-compatible native tooling, npm, Git, and system Chromium for QA. The candidate installs exact Node24.20.0 before any native/root dependency scripts, Supabase CLI3.0.0-next.25 and Deno2.9.5. Npm and native service locks are committed; `tool-versions.json` pins installed Linux binary SHA256s. Native services use newer versions than the repo-pinned Docker stack; Docker/global daemon configuration is never changed.

Start with this source checked out in an isolated candidate repository. Run from repository root. Do not copy/import any existing `.env`, Supabase home, credentials, DB, Storage or account cache.

```sh
python3 ops/cloud-compatibility/runtime/initialize-root.py
sh ops/cloud-compatibility/install.sh
python3 ops/cloud-compatibility/runtime/verify-tools.py
python3 ops/cloud-compatibility/runtime/fetch-artifacts.py
python3 -m http.server 58081 --bind 127.0.0.1 --directory /workspace/barber-cloud-candidate-state/artifacts
```

The final command is a foreground **loopback-only public-artifact mirror**; keep it in its own terminal. It serves no profile data or secrets. Use Ctrl-C in that terminal to stop it. The root initializer exclusively creates the exact0700 `/workspace/barber-cloud-candidate-state` ownership marker; it refuses a nonempty/unknown root or symlink ancestors. The install command uses a task-only Supabase tool home, never HOME overrides or account login. Downloads retain inherited HTTPS_PROXY/CA and TLS verification. Fresh npm-cache provisioning and fresh downloads of all eight official GitHub native release manifests/archives have been tested under the existing restricted policy, with all hashes matching. No new domain rule is needed. See sanitized validation receipts supplied with this candidate.

The bootstrap below must be run with `BARBER_SHARED_NATIVE_CACHE` **unset** for clean extraction/provisioning. An optional already-verified native binary cache may be copied privately with that variable for cached-snapshot startup; this is a performance option, not clean-provisioning evidence. It never copies `native-home/stacks`, credentials, DB or uploads, and never symlinks/shares writable native state.

## Exact Test commands

```sh
python3 ops/cloud-compatibility/runtime/profile.py init test
python3 ops/cloud-compatibility/runtime/profile.py start test --db-only
python3 ops/cloud-compatibility/runtime/profile.py disable-cron test
python3 ops/cloud-compatibility/runtime/profile.py stop test
python3 ops/cloud-compatibility/runtime/profile.py start test
python3 ops/cloud-compatibility/runtime/profile.py replay test
python3 ops/cloud-compatibility/runtime/profile.py pgtap test
python3 ops/cloud-compatibility/runtime/schema-check.py test
python3 ops/cloud-compatibility/runtime/frontend.py build test
python3 ops/cloud-compatibility/runtime/frontend.py start test
```

Test API55321, DB55322, frontend55173. `frontend.py refresh test` rebuilds/restarts only Test. `frontend.py stop test` stops only the receipt-bound process. `profile.py reset test` stops the owned frontend/backend, archives the complete previous profile (preserving evidence), and initializes fresh config/data/keys; rerun the remaining bootstrap steps after reset. `profile.py stop test` stops the backend only; frontend is explicitly stopped by its own command or reset. No kill-by-port or global pkill is used.

Cron is off **before** migrations. Full service startup before replay supplies official Auth helpers absent in database-only startup. Each committed migration runs in its own transaction (required by private writer SET LOCAL transfer). The direct administrative seed INSERT needs native trusted postgres BYPASSRLS, recorded only in the isolated profile; private `barber_reminder_writer` remains no-login/no-bypass and protected by its unchanged RLS. Replay is for empty app schemas and is never an implicit reset.

## Immutable Staging

Inspect and commit the sanitized candidate locally before `init staging` (no push/merge/tag/publication). Replace `test` by `staging` in the bootstrap commands above. Staging uses API56321, DB56322 and frontend56173. Init refuses dirty candidate source **before** creating resources, then snapshots the recorded commit into its own `source/` root. Every Staging operation verifies the frozen snapshot manifest; Test app edits and rebuilds do not change Staging source/dist/config/data. Staging builds its own dependencies/dist under its profile root and serves that frozen build. `reset staging` archives only that owned profile and reinitializes from a clean recorded candidate commit. It never accepts dirty source as a release.

## Actual backend checks and local QA

```sh
export PATH="$PWD/ops/cloud-compatibility/tooling/node/node_modules/.bin:$PATH"
export BARBER_CLOUD_PROFILE=test
node ops/cloud-compatibility/runtime/backend-check.mjs test
node ops/cloud-compatibility/runtime/edge-check.mjs test
node ops/cloud-compatibility/runtime/realtime-probe.mjs test
BARBER_RT_HOLD_MS=71000 node ops/cloud-compatibility/runtime/realtime-probe.mjs test
python3 ops/cloud-compatibility/runtime/profile.py baseline test
```

Repeat with profile `staging`. Edge jobs require verified empty due-reminder/old-notification queues and cron off; generated outbound integrations are disabled and email is a local sink. Realtime checks require SDK join, system postgres_changes acknowledgement, both exact Auth-session DB subscription rows, authorized delivery, live denied subscriber, and owned socket/subscription cleanup. Notes are conditionally restored. The held mode additionally instruments actual transport creation/closure and per-socket heartbeat acknowledgements; only an actual passing result establishes a continuous held connection.

The existing Chromium E2E suite uses only loopback fixtures. Its teardown now awaits forwarding handlers. `tests/e2e/booking-sidebar.spec.js` projects the existing synthetic booking date in intercepted read responses only, asserts no booking writes, and checks360/467/1365px × EN/AR × dark/light with the Test banner, hit testing and screenshots. It is UI evidence, not a substitute for actual backend/owner-browser proof.

## Optional private preview sources, not automatic provisioning

`preview/` retains the reviewed creator-only Microsoft helper; install/import never logs in or hosts. It requires an explicit selected marker-owned profile, private0700 tmpfs/D-Bus/encrypted Secret Service, official pinned CLI/MSAL assemblies, mandatory proxy/CA, initial owner authorization and service-host policy. No real credential/cache/keyring or CLI binary is bundled. `tooling/msal-official-api/probe` is source only; its official MSAL DLL must match the pinned SHA256 and remain inside the new private context. No existing credential store is selected.

HTTP/API/Storage/WebSocket/frontend routing is derived from the selected owned profile and rejects old proof/default or arbitrary ports. Origin is pinned once from authenticated service endpoint registration; ACL, exact new-ID/region/port bindings and one-hour cutoff remain. Auth transactions compare current data snapshots rather than requiring seed counts at restore. Before routing apply, config-only recovery is saved privately in the owned profile `routing-recovery/<newID>/`; it survives failed restore and OAuth RAM erasure. Recovery command:

```sh
BARBER_CLOUD_PROFILE=test BARBER_CLOUD_STATE=/workspace/barber-cloud-candidate-state/test \
python3 ops/cloud-compatibility/preview/auth-origin.py recover --owner-approved --resource-id THE_CONFIRMED_NEW_ID
```

Recovery refuses changed config/nonces and never resets data. This command does not authorize a new account/tunnel. The previous successful preview is expired/deleted; historical receipts are labeled as such. A new preview is not authorized in this readiness phase.

The root-reviewed app integration keeps existing transport-origin validation intact: local HTTP uses environment `test`, private HTTPS uses `staging`, and `cloudProfile` independently selects the translated TEST/STAGING synthetic banner. This label does not grant access; owner ACL remains a host responsibility. No new preview is created by this integration.

## Final isolation and browser validation procedures

From repository root, with both profiles running and no concurrent booking probe:

```sh
node ops/cloud-compatibility/qa/isolation-check.mjs
node ops/cloud-compatibility/qa/profile-browser-check.mjs
python3 ops/cloud-compatibility/qa/frontend-isolation-check.py
```

The last procedure makes a reversible Test-only HTML-title edit, refreshes Test, proves frozen Staging health/frontend and backend stop/start remain permitted while Test source is dirty, verifies all Staging source/dist/config hashes unchanged, then restores Test source/build exactly. It must be run on this candidate's unmodified index fixture and archives its safe result. The browser check includes English TEST/STAGING labels and narrow360/467px Arabic Staging booking-panel close checks without booking writes. All three are disposable local synthetic QA; no owner account, tunnel or remote environment is selected.

The verified runtime/app snapshot is commit `bff9fdd4c005761f849c8ff8ece539896ec84618`; later source additions are QA procedures/documentation only, with runtime/app byte-equivalence checked in the transfer manifest. Two clean cycles per profile, cross-profile JWT/API-key/data/Storage isolation, and the reversible Test-edit/Staging-lifecycle check passed. Both frontends were independently probed after startup commands returned and remained running. Native backend held-socket evidence is separate from mock/local-wire helper tests.

Optional preview prerequisites are **not part of native clean-bootstrap acceptance**: official Dev Tunnels CLI1.0.2115+e16833f284, isolated distro Secret Service libraries, .NET SDK10.0.100/runtime10.0.12, and extracted official CLI assemblies. Download only from official sources through inherited proxy/CA and verify the reviewed CLI SHA256 in `credential-bootstrap.py`; never reuse a default cache/HOME or account credential. The source-only MSAL reader compiles with the SDK; set `BARBER_DEVTUNNEL_ASSEMBLIES` to the new verified binary-only extraction before running its dummy preflight. Build output/default selector remains `tooling/msal-official-api/probe/bin/Debug/net10.0/Probe.dll` and the explicitly supplied .NET runtime under `tooling/msal-official-api/dotnet/dotnet`. Neither tool binary nor library/root-keyring installation is bundled. These prerequisites and a fresh owner authorization remain explicit before any future live preview; native Test/Staging editing does not need them.

The repository Chromium suite can also select either already-running owned profile without shared QA dist/default API routing:

```sh
python3 ops/cloud-compatibility/runtime/run-e2e.py test
python3 ops/cloud-compatibility/runtime/run-e2e.py staging
```

This config derives API/public browser key/frontend ports from validated profile metadata; Staging tests come from its frozen source snapshot. Browser output is per-profile and traces are disabled. There is no fallback to the earlier proof's54321/5173 services.
