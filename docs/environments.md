# Two environments

## Local Test

Use Node 24.20.0 and Docker Desktop. Work on `dev` or a feature branch based on
it. Run `npm run local:setup`, then `npm run local:start`; review the app at
http://localhost:5173. Pushing `dev` runs CI; local files already update Vite
through hot reload.

The dedicated project is `barber-local-test`. API: 55321; database: 55322;
Studio: 55323; mail viewer: 55324. Published ports are restricted to loopback.
Credentials and operational state are ignored by Git. Setup refuses a linked
remote project and generates its own local credentials. The browser validator
rejects non-loopback backends for Test. A visible Test banner identifies the app.
The named profile belongs to one checkout; another checkout cannot silently
reset or stop its data. Retire or deliberately migrate the owned profile before
switching its canonical checkout.

`local:stop` preserves data. `local:start` preserves data. `local:reset`
explicitly destroys and rebuilds this Test database from migrations and synthetic
fixtures. Five synthetic users cover admin, manager, agent and barber roles,
including another tenant. Their test-only password is `LocalOnly123!`;
the manager is `manager@barber.test`. Never use these credentials in production.

Auth, REST, Realtime, Storage and Edge Functions run locally. Email stays in the
local viewer. Real messaging and paid integrations are disabled by default.
Local CLI service versions differ from production: PostgREST is pinned to v16.4
for the reviewed login fix, while production uses v14.12. Production image
identities are recorded separately in `ops/release/runtime-lock.json`.
Successful local startup proves local functionality, not exact production parity.

## Production

The frontend Hostinger VPS runs Dokploy, its own PostgreSQL/Redis, Traefik,
one Barber++ application, and required release/monitoring services. The existing
Supabase installation on the backend VPS retains all production customer data,
Auth, Storage, Functions and backups.

`main` is the production release branch. A successful main workflow builds
immutable frontend and Functions source artifacts. An outbound-only controller
polls GitHub every 60 seconds. It verifies repository, workflow, commit, artifact
digests, migration hashes and attestations, then applies compatible backend
changes before requesting the frontend deployment through the local Dokploy API.
The controller stays disabled until the first cutover is accepted.

There is no permanent staging environment and no cloud preview dependency.
Platform upgrades and incompatible migrations require a separate planned release.
