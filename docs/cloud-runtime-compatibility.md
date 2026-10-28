# Cloud runtime compatibility

The cloud candidate is a disposable development runtime. Its native Supabase
services run the application's committed migrations, functions and synthetic
seed data. Passing these checks establishes functional compatibility with those
specific binaries; it does not establish equivalence with a deployed Docker
image or a live server's configuration.

## Runtime identities

Repository reference: `c82c6539ed1fd2db6eb39bd0dd7c7569bc938877`.
The cloud [service lock](../ops/cloud-compatibility/runtime/native-services.lock.json)
records native archive and manifest hashes. Release references below are source
configuration, not observations of what is currently running in production.

| Component | Cloud candidate | Repository release reference |
| --- | --- | --- |
| Supabase CLI | `3.0.0-next.25`, isolated tooling | `2.116.0` in `package.json` |
| PostgreSQL | `17.11.0.006-r0` native package | `17.11.0.002` pinned in `ops/staging-vps/Dockerfile.postgres` |
| Realtime | `v2.147.1-r0` native package | Hardened image based on `v2.140.7`, documented in `ops/staging-vps/realtime-security/README.md` |
| Edge Functions | `v1.77.8-r0` native package | Security release image defined in `ops/staging-vps/Dockerfile.functions-release` |
| PostgREST | `v16.5-r0` native package | Resolve the exact image from the selected release manifest before acceptance |
| Auth and Storage | `v2.197.0-r0` and `v1.84.21-r0` native packages | Separate security image definitions under `ops/staging-vps/` |

Do not upgrade existing environments to make this table match. Keep the cloud
runtime pinned and record differences with each accepted candidate.

## Profile labels and preview transport

The optional browser setting `cloudProfile` identifies the selected synthetic
`test` or `staging` profile. Each has its own visible English/Arabic banner.
The existing `environment` setting retains its transport validation contract:
`test` requires loopback URLs; `staging` requires HTTPS. A remote cloud preview
therefore uses `environment: staging` together with the actual `cloudProfile`.
Both browser-facing URLs must equal the single assigned Microsoft preview
origin. The server-side proxy binds that origin to the selected owned profile.

The browser label is not an access control. Creator-only authentication,
the pinned service origin, the one-hour lifetime and cleanup are enforced by
the preview tooling. No cloud profile is accepted in production configuration.
Existing configurations without `cloudProfile` retain their previous behavior.

## What a cloud pass covers

- Migration replay, application schema comparison and database security tests.
- Synthetic authentication, application queries, Edge Function behavior and
  authorized/denied Realtime subscriptions.
- Browser journeys and responsive layout against that candidate's source.
- Test/Staging isolation and lifecycle checks, when their receipts explicitly
  record a pass for the same candidate.

External email, WhatsApp and other real integrations are not exercised by
synthetic checks. A service-role Storage probe does not prove an ordinary user's
image-upload permissions. Those flows need their own positive and negative
tests when changed or included in release acceptance.

## Production acceptance requirement

Before enabling cloud-to-production promotion, run a separate acceptance suite
against the exact frontend and Functions image digests and the intended backend
runtime configuration. Record the migration tree, image provenance and runtime
identities together. Test both successful user journeys and denied access.

The initial cloud Docker attempt exhausted the available filesystem while
unpacking PostgreSQL. Native startup resolves development feasibility but does
not waive the image acceptance requirement. A suitable isolated runner or
verified resource configuration is needed for that step; do not run it against
an existing hosted environment to fill the evidence gap.

See [production handoff](cloud-production-handoff.md) for the missing acceptance
artifact contract and release-specific backup, rollback and approval gates.
