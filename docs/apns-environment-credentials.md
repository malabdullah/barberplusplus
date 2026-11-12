# APNs credentials for USB and TestFlight installations

This candidate is separate from the landing-page refresh. It changes no native UI, account, booking, preference or device token. It has not been released to production.

## Contract

Both booking and announcement dispatchers choose credentials from the job's explicit `environment`, after validating the app/API/topic and current delivery eligibility. The legacy `customer_push_apns` key remains a sandbox-only fallback. An explicit malformed slot fails closed. A production job never uses the sandbox key. Missing or unusable credentials finish with retryable `503 CredentialUnavailable`, without contacting APNs or invalidating a valid device. Existing bounded leases/retries and consent checks remain in force.

`private.customer_push_configuration()` returns a server-only `credentials` map, in addition to its unchanged legacy fields. The public wrapper is SECURITY INVOKER and only service_role can execute it. The new service-only `configure_customer_push_credential(environment, config)` imports or rotates exactly one Vault slot, binding its environment, topic and API from the existing runtime. It accepts exactly privateKey, keyId and teamId; it preserves the legacy secret, dispatch secret, enabled flag and runtime allowlist. Hosted Test rejects production imports. PEM format is checked at import; cryptographic validity and portal scope must also be verified during the approved private import.

## Hosted Test receipt, 12 November 2026

- Applied migration `20261112101059_apns_environment_credentials.sql`; the filename matches the actual hosted ledger.
- Deployed customer-push-dispatch version 9, bundle `3e5c3333a8beb4f63fc4c9861828ecdedb7f2db3e4408585c2d8de6ba848c19e`.
- Deployed admin-push-dispatch version 5, bundle `dd6e66f833d199c6d2a386fc9389105a6d91f425e25ec5c7eb14a6050fe76234`.
- Both unauthenticated endpoint calls return 403. No dispatch secret was used to claim pending work.
- New rollback-only SQL suite: 46 assertions, zero failures. It covers service-only permissions, Test production denial, invalid inputs, bindings, sandbox/production separation and rotation preservation.
- Existing rollback-only native release (33 assertions), booking defaults, announcement phase 2 and guest receipt (34 assertions) suites completed without failure diagnostics.
- Full Functions suite: 208 passed, including 23 focused APNs tests with ephemeral keys/fake provider dependencies; no real APNs calls. Frontend: 339 passed; operations: 63 passed. Lint/type checks, migration names, domain checks and production build passed.
- Test runtime remained sandbox-only, announcement delivery remained capture, 59 device registrations remained present, and opaque hashes of legacy key, dispatch secret and customer preferences matched before/after. No environment-specific secret persisted from the rolled-back SQL tests.
- Security advisor findings were unchanged; no new finding was introduced. Existing notices are outside this candidate. [Supabase advisor guidance](https://supabase.com/docs/guides/database/database-linter).

## Reviewed production sequence — requires separate release approval

1. Confirm exact commit/artifact, production migration prefix and backup. Replay on the exact production database/Functions image through the maintained release checks. Do not include the landing candidate or older Test-only features in this backend release.
2. Apply this migration and deploy both compatible dispatchers while the runtime is still sandbox-only. Preserve the existing live key, dispatch secret and all notification flags/preferences.
3. Under separately approved server access, verify the owner-created key's Apple portal metadata: key `23W9GG8UV6`, team `D49RFZQ6BT`, production-only topic `com.barberplusplus.customer`. Validate the protected P-256 private key without printing or committing it. Import only through `configure_customer_push_credential('production', ...)` using a protected server-side client/file. No key belongs in logs, shell arguments, public configuration or frontend assets.
4. Verify the imported slot's public metadata and cryptographic usability, legacy key `24Z6RHLTR4` hash equality, unchanged flags and service-only ACLs. The key must be stored before expanding the runtime environments.
5. Enable `['sandbox','production']` for the exact live API/topic only after both dispatchers and the production slot are verified. The booking sender caches configuration for 60 seconds: allow the cache to expire or explicitly verify refreshed workers before readiness. Keep App Store Connect build 19 unassigned until that receipt exists, so no new TestFlight token races activation.
6. The iOS distribution archive must report production APNs in both its signed entitlement and app metadata. USB builds continue registering sandbox explicitly. Do not guess environment from the backend URL, rewrite old tokens or change installation secrets/versions.
7. An actual owner-device alert requires a separately bounded send approval. Fake/capture-only Test validation is not proof of production APNs acceptance. After verified compatible workers, Vault import, runtime allowlist/cache refresh and preservation checks, build 19 may be assigned to the private owner beta group under its release approval. Only then can its TestFlight installation register a production token for a separately approved real alert test. Restore temporary access and remove transient private key copies only after secure Vault storage is verified, under the approved key-handling scope.

## Recovery

If production delivery needs to be held, restrict the runtime allowlist back to sandbox while preserving both Vault slots and existing user preferences. Do not invalidate production registrations merely because a credential is unavailable; do not replay old events. Do not reverse the migration by dropping credential secrets or restoring account data. A broader sender rollback needs review because older code does not select production credentials.

Secret-scan review: its two initial findings were a PEM validation regex and a deliberately invalid fake test value, not actual credentials. The test value is now constructed at runtime. Only the validator expression has an inline false-positive annotation; the scanner and its rules remain enabled. No real private-key contents were read for this remediation.
