# Account deletion: production preparation boundary

The hosted Test pilot is deliberately **not ready to deploy unchanged to production**.
This file records the exact release work still required; it is not production
approval, an enabled customer feature, or a claim of App Store acceptance.

## Current immutable Test evidence

- Test project and gateway are pinned in the Function. Normal accounts fail the
  server-side disposable-QA allowlist. Production has not received this schema.
- Purpose-bound deletion proof, atomic anonymization/future cancellation, session
  revocation, leased retry/receipt recovery, canonical verified-phone cleanup,
  Auth/Storage removal and report invalidation are exercised on hosted Test.
- Test mail is captured. `index.ts` intentionally throws `EMAIL_UNAVAILABLE`
  outside `cloud-test`; it must not be described as a production mail integration.
- `/support` is public to app users (the separate Test access gate still applies).
  `/privacy` is a Test draft with native/deletion/sharing disclosures.
- Automatic Apple revocation is absent; manual Apple Account revocation is the
  documented fallback. Native key/client scope is not verified or copied.

## Required scoped implementation before a release proposal

1. **Build the production mail adapter without activating it.** Use the existing
   approved Resend transactional sender `noreply@barberplusplus.com`, with support
   replies handled by Zoho `support@barberplusplus.com`. Read credentials from
   server secrets only. Send the deletion-specific six-digit proof and ten-minute
   expiry through the approved branded HTML/text templates. Include an idempotency
   key scoped to operation + send generation; bounded timeout, safe generic
   errors, no code/contact/provider-response logs. Do not repurpose a sign-in or
   password-reset token as a deletion code. Test production formatting/failure/
   retry with an injected mock sender; real delivery needs release permission.
2. **Separate pilot and production enablement.** Add an explicit default-off
   environment switch and an operator-only runtime configuration for each exact
   production origin/API URL, verified from the current release configuration.
   Keep Test permanently tied to its existing project and disposable allowlist.
   Do not flip `test_mode` or remove Test guards globally. Ordinary customers may
   become eligible only after the approved production enablement step; linked
   managers/barbers/admins remain denied pending a separate work-account policy.
3. **Prepare compatible production migrations/artifacts.** Review the actual
   production catalogue read-only and consolidate the Test validation corrections
   into a scoped release sequence with verified hashes. Do not cherry-pick the
   entire reports-based Test branch: reports phase 1 remains a separate release.
   Treat optional Test-only review/report tables through guarded dynamic SQL.
   Verify exact production Auth/Storage/Functions image behavior and privileges,
   expiry, live-session Storage/Realtime guards, canonical phone registry,
   cancellation side effects and notification queue behavior. Never import Test
   credentials, fixture IDs, private mailbox or allowlist into production.
4. **Prepare the cleanup worker.** Use the exact production Function URL and a
   separate server-only random dispatch secret. Keep it disabled until the schema,
   Function and mail adapter pass review. Cron/worker retries must remain leased,
   bounded and idempotent; pending status stays truthful through an outage. No
   dispatch route receives arbitrary user IDs. Establish no-PII pending-age/error
   monitoring and an operator recovery procedure without restoring erased data.
5. **Finalize public surfaces and native integration.** Publish only the reviewed
   production privacy policy/support route with matching native App Privacy
   disclosures. Native tests must cover proof, two affected future appointments,
   preserved anonymous past history, switched-account isolation, cold launch,
   lost-response recovery and Apple manual-revocation wording. Keep existing
   production/TestFlight releases until owner acceptance. A live deletion demo
   must use a separately approved disposable production identity, not owner/admin.
6. **Create the reviewable release candidate.** Provide exact changed files,
   migration/Function hashes, production configuration names (not values), mocked
   sender evidence, exact-image results, native results and restore/disable steps.
   Disabling the feature/worker stops new requests; it cannot undo a committed
   anonymization. Apply the normal dev → main → production workflow only after
   the owner approves that concrete candidate. Use fresh scoped server-access
   approval if operational access is required; no SSH access is reopened now.

## Approval checkpoint

The next owner decision concerns acceptance of the Test customer experience and
policy, followed by the separately prepared production candidate. No production
mail, deletion, configuration change, website deployment or public app submission
is authorized by this document.
