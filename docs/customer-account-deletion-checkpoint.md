# Account deletion — paused draft, 13 November 2026

The owner requested a safe pause for a MacBook Air restart. This is an
**unverified draft**, not a ready or deployed deletion feature.

## Saved source and environment

- Website branch: `codex/customer-account-deletion-test`, based on approved report
  layout commit `f9d9102be5c7d9ea091e29230698e5e125a50e69`.
- Current worktree: `/private/tmp/barber-account-deletion`. Temporary directories
  may not survive restart; recover this branch from GitHub if needed.
- Hosted Test remains the reports layout at that base commit, using only
  Supabase `qvkucvcjmojjbphlzlks`.
- Main, dev, production and native TestFlight were not changed.
- The migration application confirmation expired. A read-only check confirmed
  `private.customer_deletion_jobs` does not exist. **No deletion migration,
  Function, cleanup worker or website deletion screen was deployed.**
- The direct `deno check` command failed because the shell did not resolve Deno.
  Run the project-local executable through `npx deno` or npm scripts next time.
  No deletion draft tests have passed yet.
- `node_modules` here is an untracked symlink to the reports worktree; do not
  commit it. Reinstall locked dependencies if that temporary target disappears.

## Verified owner authorization

Read the latest human messages in iOS chat
`01a1963b-130e-76c3-9d8e-ba685a06f65a` before relying on coordination context.
The owner explicitly authorized Test-only shared account deletion and native
integration, using disposable QA accounts only, with no real-owner/production
deletion. They approved cancellation of future appointments upon explicit
deletion, retained anonymized soft-deleted booking/report records, removal of
personal details, private notes, favourites and ratings, and unrecoverable access.

The iOS agent accepted purpose-bound email-code reauthentication to the verified,
server-owned immutable email, plus a durable opaque receipt/status flow. It is
holding native integration until the actual tested contract is delivered.

## Draft implementation

- CLI-created migration `20261113112440_customer_account_deletion.sql` introduces
  tombstones, private deletion jobs/runtime, service-only dispatch, eligibility,
  email/password proof, preview version checks, application data anonymization,
  session revocation, resumable Auth/Storage cleanup and a disabled-until-configured
  Test cleanup cron. It defaults to an empty disposable-QA allowlist requiring
  trusted `deletion_qa` metadata and `@example.test` identities.
- `supabase/functions/customer-account-deletion/handler.ts` is a bounded-body,
  authenticated, whitelisted API draft. Receipt-only polling/retry is scoped to
  an already approved operation. Codes/receipts/identities are never logged.
- `index.ts` is Test-only, captures verification email in the private mailbox and
  attempts only owned Storage/Auth cleanup after atomic application erasure.
- These drafts need careful review, syntax/type checks and rolled-back disposable
  SQL/handler tests before any application or migration deployment.

## Next work

1. Review the draft SQL, concurrency/role/scope guards, session invalidation,
   idempotency, retries, lease behavior, mail failure and erased-record write guards.
   Test only named new disposable fixtures. Do not relax the pilot allowlist.
2. Bound large previews and ensure report snapshots cannot export erased personal
   data: mark affected runs stale, scrub snapshot payloads, and check readiness
   immediately before Excel download. Add report refresh on focus if needed.
3. Test all cleanup paths, including queued/sent email/push, share versions,
   ratings/aggregate refresh, aliases, reused devices and role changes. Preserve
   anonymous booking money/date/service history; never infer identity by names.
4. Finish website `/customer/delete-account`, guarded local account/draft cleanup,
   receipt recovery and bilingual UX. Make `/support` public without sign-in.
5. Update privacy wording for website/native and deletion, while documenting
   provider logs/backups, external copies and support inbox limitations honestly.
   The old policy incorrectly advertises a removed Stop sharing control.
6. Apply and verify only on hosted Test after any required migration confirmation.
   Add the Function to the Test Worker allowlist, deploy the Function, then enable
   its Test runtime with explicitly scoped new QA IDs. Preserve the reports UI.
7. Supply exact native request/response/error/expiry/retry and session-invalidation
   receipts after testing. Keep main/dev/production unchanged until owner review.

## Apple and privacy boundaries

Only Test web Services ID `com.barberplusplus.authentication.test.web` was verified
in existing local configuration. Its signing key is held by the separate renewal
worker. Native client/key scope was **not** verified. No signing key was copied or
new credential permission granted. Automatic Apple revocation is not implemented
or tested. Apple TN3194 documents app-data deletion plus manual Apple access
revocation when tokens are unavailable; do not claim automatic revocation or
App Store acceptance without the remaining evidence/owner decision.

The native agent reports its Google SDK handles identifiers and IP-derived coarse
location; its manifests include further linked usage/analytics declarations.
FirebaseAuth includes diagnostic/user identifiers. Face ID templates remain with
iOS. Reconcile exact SDK versions and actual use; do not claim zero technical
data collection or invent legal retention periods.

Private schema inventory and human approval evidence are backed up under the
owner-only `.cloud-test/checkpoints/customer-account-deletion-2026-11-13/` in the
persistent root checkout. Existing Test secrets remain in their established
private files; never add them to Git or substitute production credentials.
