# TEST-BOOK-01 preparation and separate review — October 11, 2026

Status: validated in isolation; not merged, installed or applied to live Test.
The owner authorized preparation and isolated testing only. The live b04eacd
release and its acceptance freeze were preserved; production was not accessed.

## Defect and narrow correction

A normal manager's future booking failed with 403 / 42501 because an invoker
trigger tried to insert into the deliberately private reminder table. Browser
reminder privileges remain revoked. Existing booking RLS/constraints authorize
the original statement before a private AFTER ROW trigger maintains its reminder.

Migration `20261011085658_private_booking_reminder_triggers.sql`, SHA-256
`37877dc53acdb831f6845adc5eee7af51a3a1791d4a44a05af86f0a9ee172ca9`, adds a
NOLOGIN/NOSUPERUSER/NOBYPASSRLS writer. It has only reminder identifier/status
SELECT, booking/scheduled-time INSERT and status UPDATE. No DELETE, booking
read, Auth-schema access, database/role creation or replication privilege.
Three writer-only policies require trigger depth one. The private function
validates relation, trigger name, AFTER ROW operation and a trusted caller ID
(or service/migration context), uses an empty search path and qualified names,
accepts no RPC arguments, and is not executable by API roles.

This is not a postgres-owned definer RPC bypassing booking authorization. The
restricted owner remains subject to RLS. PostgreSQL automatically gives its
non-superuser creator an ADMIN-only grant, alongside the explicit SET-only
grant required for ownership management; both are restricted to trusted
`postgres`, not API roles. The recovery contract accepts exactly those grants,
not arbitrary memberships. See [PostgreSQL role attributes](https://www.postgresql.org/docs/17/role-attributes.html)
and [Supabase function security](https://supabase.com/docs/guides/database/functions).

Existing reminder timing and repeat-cancellation semantics are preserved. This
does not redesign rescheduling, enable delivery or modify data columns/APIs.

## Genuine isolated evidence

Native AMD64 rehearsal `barber-test-rebuild-4c1028837d8018dd` passed at
**12:42:43 Kuwait / 09:42:43 UTC** on srv1207055. It used five independently
pinned services, fresh volumes/secrets and source-controlled synthetic fixtures.
The prior failure was reproduced before the migration. Then:

- 32 existing and 35 new pgTAP assertions passed.
- Admin, manager, agent and barber API booking create/modify/cancel passed.
- Direct reminder access and cross-tenant reads/writes were denied.
- A logical dump was restored inside the labelled disposable cluster after
  dropping only its test database/role. Fixed-purpose role recreation preserved
  restricted ownership, and all 35 new assertions passed again.
- Live container identities, accepted runtime identity and freeze bytes stayed
  unchanged. Only labelled disposable resources were removed.

Receipt is `evidence/test-2026-10-11/booking-migration-rebuild.json`.
This proves writer-role logical recovery on disposable data, **not** independent
lost-server backup restoration, Vault/Storage recovery or production readiness.
The outstanding Mac Realtime restore failure remains unresolved.

Failed rehearsals are retained privately: missing Storage initialization,
transaction-scoped pgTAP setup, initial ACL/fixture assumptions and automatic
creator-role metadata. None is relabelled as a pass. The final role, API and
recovery tests passed with strict assertions rather than skipped checks.

## Checkpoint compatibility and security review

New v3 Test checkpoints record the exact non-login writer metadata only when
bound to this migration hash. Restore creates that fixed role in a fresh labelled
target before logical import. Extra grants, login/bypass privileges, unknown
settings, secrets, missing role data and mismatched migrations are rejected.
Historical v1/v2 readers and Realtime-role validators are unchanged; older v3
checkpoints without this migration need no extra role. The public schema fixture
was generated from isolated schema-only output using the pinned dump rules.

Security advisors ran against the isolated database. Eight existing WARN-level
mutable-search-path findings remain in legacy functions: `mask_pii`,
`reset_auth_rate_limit`, `update_whatsapp_conversation_timestamp`,
`create_booking_reminder`, `cancel_booking_reminder`, `check_auth_rate_limit`,
`detect_suspicious_booking_activity`, `detect_suspicious_login_activity`.
The new private helper is not among them. These are not covered by the prior
image-CVE acceptance, suppressed or claimed fixed. Maintainer disposition and
appropriate owner acceptance/remediation remain separate closure gates.
Raw advisory reports are private on the Mac and in the preparation snapshot.

Separate solo-owner review: checked trigger-only entry, trusted claims, least
privilege, grant ordering before ownership transfer, exact metadata recovery,
legacy compatibility, SQL-only fixture scope and destructive-target labels.
This is a separate review pass, not independent human review. Repository checks,
new role/checkpoint tests and migration naming passed. Combined CI must pass
all five required checks before a proposed main merge.

CI's fresh database replay/schema-drift job passed on the first combined head.
The separate compatibility driver used autocommit migration execution, unlike
the CLI and native rehearsal. It now wraps each migration in a transaction;
the SET LOCAL ownership transition is not changed or bypassed. All five checks
must pass again on this correction before merge approval is requested.

## Deployment gates still required

The combined candidate includes the already-reviewed navigation fix from PR #7;
do not merge that PR separately. Obtain exact combined commit merge/build
approval, all five CI checks and immutable-image publication first. Then obtain
explicit approval of the concrete Test release, reviewed helper installation,
fresh encrypted Mac-verified checkpoint and this exact stateful migration.
End the old freeze only for that approved operation; serialize it with capture
and maintenance. Execute the migration transactionally, without reset/reseed,
change no backend image/secret/routing, and record five migration hashes.

Retest real booking journeys, direct denial, ordinary browser, responsive layout
and integrations; freeze the new candidate, finish owner iPhone testing and
obtain final acceptance. No automatic database downgrade, production promotion,
real AI/WhatsApp or deployment-worker activation is authorized here.
