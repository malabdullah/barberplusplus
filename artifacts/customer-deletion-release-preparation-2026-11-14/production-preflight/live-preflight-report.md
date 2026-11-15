# Production metadata preflight — 14 November 2026

**Read-only inspection completed; release is not yet authorized.** One SSH attempt completed successfully under the reviewed revision2 script. The owner approval was directly verified in the iOS chat (message `01a1d7d0-6bef-7110-b672-a2afb63cb414`). No application deployment, credential creation/use for a new purpose, real provider call, message or customer-record query occurred.

| Check | Observed result | Meaning |
| --- | --- | --- |
| Runtime | All four pinned containers running/healthy; image IDs match the reviewed lock; PostgreSQL17.6, x86_64 | Exact platform identity matches rehearsal parent |
| Authoritative ledger | 102 applied migrations; exact reviewed main prefix | Nine reviewed deletion/Apple migrations remain pending; no ledger adoption/replay needed |
| Backend journal | FUNCTIONS_APPLIED, recorded commit55f7bb615cdd00d632e64d7eb352210c20854c34 | Journal matches baseline; this does not attest frontend state |
| Installed public helpers | Renewal, backend and backup-policy hashes match reviewed source | No helper was executed |
| Daily B2 receipt | Captured14Nov03:15Kuwait, verified03:15Kuwait; age1h59m at inspection; same-system, encrypted offsite and all restoration flags true; recorded restore13.65s | Current original receipt passed metadata freshness/binding gate; no fresh archive download/restore performed |
| Apple login | Exact production web/native pair, expected team/audience, ES256, unexpired to29Apr2027; renewal state HEALTHY_NOT_DUE | Current login renewal metadata is healthy; JWT signatures/key portal scope were not verified |
| Renewal/backup timers | Both loaded, enabled, active/waiting | Scheduled metadata present; no schedule changed |
| Deletion deployment | Deletion/Apple tables absent; no temporary probe schema; new Edge credentials/flags absent | Expected unreleased state, not a failed installation |
| Existing Function bindings | Production website/API/internal api-gw bindings match; existing mail/service/cron credentials present in Functions | Preserve those existing values during a future separately approved setup |
| Selected cron query | Empty for the three exact queried names | Deletion cron is expected absent before its migration. Notification cron names in the probe were narrower/incorrect; their health is **inconclusive**, not missing/broken |

The committed notification schedule names are `customer-native-push-dispatch` and `customer-booking-email-dispatch`; the frozen inspection queried `customer-push-dispatch` and `customer-booking-email`. The latter result must not be used as evidence that notification scheduling is absent. The frozen script was not broadened or rerun on Live.

The original database firewall profile367995 and all five rules were visibly restored unchanged. The exact added operator SSH rule was removed from the inactive temporary profile400860; it now has only the five copied original rules. No inspection SSH process remains. Activation-request to cleanup-receipt elapsed169seconds, within the one-hour limit. No frontend profile was accessed or changed. The unused five-rule copy remains inactive; deleting the profile was outside this cleanup scope.

## Remaining gates

1. Prepare and test durable renewal for both new Apple cleanup client secrets; current installed helper renews login only. Review existing Live key scope and new use separately, then approve protected credential/encryption/recovery setup. Existing login configuration must remain intact.
2. Freeze the final release source and matching built/attested artifacts, required CI, migration hashes and compatible rollback. Candidatee32cfb9 remains unchanged; later commits contain evidence/proposals only. Refresh expiring runtime/backup evidence at actual release time and verify the correct deletion/notification schedules then.
3. Obtain the explicit production release/activation approval; apply only nine pending migrations, Function/frontend changes and fixed production configuration, publish accepted EN/AR wording, and verify actual deployment. No production writes are authorized by this preflight.
4. Separately approve precise disposable Live acceptance and reviewer-account eligibility/delivery/provisioning. The proposed support inbox has not been looked up or used.
5. Native App Privacy publication, build upload, submission and public release remain separate owner decisions. No real owner account deletion is proposed.

This inspection does not close frontend/full-schema/Apple-key/provider acceptance gates. See the metadata result and receipt for immutable hashes and exact limitations.
