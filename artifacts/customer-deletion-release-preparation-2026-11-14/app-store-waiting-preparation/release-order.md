# Website release ordering and remaining gates — preparation only

No push, merge, CI dispatch, production read/write, activation or publication is
authorized by this document. Cached Git refs are not a fresh GitHub/Live check.
Machine evidence and source anchors are in `source-checks.json`.

## Source and existing evidence

Frozen core `e32cfb9105c2652fab8c2065af7280bf7dc76ec9` is based on cached
main `55f7bb615cdd00d632e64d7eb352210c20854c34`. Cached dev
`0a5da719201b2ec3162dbea89b69ff835c73cb3d` is its ancestor, **eight commits
behind main**, not a parallel Reports release. Main's staff/MFA/session security
fixes and five migrations must not be lost by copying stale dev files over main.

The core adds nine ordered migrations to main's unchanged 102-file prefix
(111 total). The previous exact-image rehearsal already passed 48 SQL suites /
1,144 assertions, 16 Edge workers and synthetic Auth/Storage cleanup/recovery.
It is not being repeated. Main ledger metadata was last verified before setup;
setup performed no SQL. A fresh ledger/schema/runtime check still belongs to
the later approved release. Reports and temporary Apple probe source remain
excluded. Operator preparation after e32 has not changed app/SQL/Functions,
the runtime lock or the original login signing helper.

The approved default-off setup is complete, not a source release. Production
now has the correct explicit backend pin, complete scoped cleanup pair, stable
independent encryption key/recovery copy and enabled maintenance timers; all
three feature switches are false. Do not reinstall/bootstrap/regenerate these
materials during delivery, overwrite the override, or copy Test configuration.

## Controlled sequence after remaining approval gates

1. Complete separately approved post-install backup/selected-file proof and
   resolve owner-held current recovery credential binding. Confirm the exact
   accepted EN/AR privacy/support/deletion wording (copy SHA178a534e…) still
   matches the final public source and native disclosures. Wording acceptance
   already exists; publication/upload/submission are separate decisions.
2. Freeze the exact delivery commit/diff and compatible rollback artefacts. Keep
   main's security baseline and the e32 runtime content; exclude Reports/probes,
   unrelated root worktree changes and private operation files. The isolated
   branch also contains later documentation/operator source; review the exact
   publishable diff instead of assuming its HEAD equals the immutable core SHA.
3. With explicit dev→main→production release approval, first refresh GitHub refs
   read-only and recheck ancestry/diffs. If the recorded ancestry still holds,
   advance dev by normal fast-forward/reviewed PR to the approved main-based
   delivery head. Do not force-push/reset or downgrade main. A new divergence
   requires reconciliation before proceeding. Keep the separate Test overlay.
4. Require CI application, browser and database jobs for the exact delivery head.
   Do not inherit a green result from e32, local checks or another tree. Browser
   CI uses its isolated synthetic runtime; owner-hosted Test remains preserved.
   Then use a reviewed main PR. Main push triggers release packaging and may be
   observed by the production controller, so verify the controlled release/hold
   procedure first; a push is not merely a harmless source backup.
5. Validate that exact main workflow run's attested image digest, backend archive,
   release manifest, ordered migration hashes and runtime lock. The package
   contains managed Functions/migrations/release tools, not `/etc` secrets or
   auth-maintenance installation. No real immutable release artefact exists now
   for the future commit; do not create mock PASS/attestation/digest records.
6. During newly approved bounded access, refresh actual migration/hash ledger,
   schema fingerprint, healthy pinned images, existing Functions inventory,
   gateway routing, unchanged prepared configuration, helper hashes/unit state,
   and original fresh backup readiness. All nine pending files create/alter
   privileged routines/tables/ACLs; the automatic SQL guard rejects them. Use the
   separately reviewed transactional migration/adoption procedure, exact hashes
   and ledger/fingerprint updates. Do not weaken `automatic_sql`, replay the
   baseline, fabricate ledger entries or force-clear failed release journals.
7. Deploy the compatible deletion Functions and shared modules with the existing
   versioned backup/drain/rollback procedure. Preserve protected main gateway,
   installed operator helpers, live Compose override/keys, Resend/Auth settings,
   public/internal pins and runtime images. A Functions source restart retains
   the prepared OFF environment. Verify schema/RLS/service-only wrappers and
   closed legacy bypass with `ops/account-deletion/apple-readiness.sql` plus the
   selected catalogue checks. Do not print the private runtime dispatch secret.
8. Verify exact `customer-deletion-cleanup` cron and private
   `kick_customer_deletions()` transport/secret presence, API route, immutable
   deployment identity from existing mail runtime, and absence/age/count of
   pending jobs/tasks. Fix nothing by changing a namespace or erasing tasks.
9. Publish the matching frontend/accepted public pages through the controlled
   backend-before-frontend delivery path; verify actual commit/image digest,
   HTTPS, runtime pins, public `/privacy` and `/support`, customer route/API and
   default-disabled behavior. This is not Apple provider or destructive proof.
10. Enable the database target and HTTP capabilities only under explicit release
   activation approval and after all prerequisites. Service-only
   `configure_customer_deletion('production',true,'{}'::uuid[])` fixes the Live
   dispatch target and no Test allowlist; it does not enable HTTP by itself.
   Cleanup requires its own true switch; new requests additionally need the
   new-request true switch and existing mail key. Apple capability additionally
   needs its independent true switch, complete valid Live pair and encryption
   key. Native/web `apple-status` is authenticated and is not a public health
   endpoint; availability is not proof of a real exchange/revoke.
11. Separate owner-approved disposable production acceptance/provider/message
   scope must name exact accounts, cancellations, messages and cleanup. The
   owner's regular account/admin are excluded. Do not call start/resend/confirm,
   dispatch/retry or Apple registration as a supposedly read-only release check.
   Reconcile actual native25 API behavior/legacy fallback before final notes.
12. Restore access immediately. Root separately requests upload, build selection,
   submission and public release approvals. Current permission is preparation only.

## Recovery constraints

Stop new requests first. Keep cleanup, Apple capability, credentials/encryption
and database target on for already accepted jobs. After the queue is truly empty,
the guarded operator may disable cleanup/target under a reviewed plan. Pending
counts/age/leases, not customer data, belong in safe monitoring.
Compatible frontend/Functions rollback must retain a backend capable of finishing
stored Apple tasks. Do not downgrade away their contract, reverse SQL, restore
a database over customer writes, delete envelopes or falsely mark completion.
The pre-setup original configuration is historical rollback evidence for setup;
it is **not** a safe release rollback after accepted deletion jobs exist because
it removes their credentials/cleanup switches. Preserve the installed key version.

`docs/customer-deletion-production-readiness.md` and the original review package
contain earlier gate descriptions (including pre-install wording). This addendum
and actual receipts reconcile them without modifying frozen historical evidence.
