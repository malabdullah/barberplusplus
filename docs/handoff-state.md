# Handoff state and unfinished work

Snapshot: 26 November 2026, Asia/Kuwait. This is a dated orientation record,
not a live deployment dashboard or approval to resume another agent's work.
Update it after a verified release, hold/ownership change or handoff. Follow
[handoff](handoff.md) to refresh actual identities before acting.

## Documented baseline

| Component | Last verified/reported state | How to refresh |
|---|---|---|
| Website running production | Public runtime `adb04de12851e90d87d703ba6021e0d3850c9091`; unchanged by documentation activation | Read approved public runtime; reconcile accepted GitHub artifact/image and controller receipt through the backend owner |
| Website documentation | Main `8e77bb24dd380bef8c1f722d8ced494f181a894a`, dev `657357fbbe27d74f9ef7b169c89ac45edbd7f8f4` before this handoff update; identical file trees | Fetch/read current refs; documentation commits need not be deployed app versions |
| Website PR enforcement | Main requires application, browser, database, dependency-review, secret-scan and documentation-review; dev requires documentation-review | Read GitHub branch protection/rulesets and PR results; preserve concurrent changes |
| Hosted Test | Isolated Worker/Supabase `qvkucvcjmojjbphlzlks`, retaining separate feature pilots | Read gated runtime and approved backend/migration identities; ask Website/Apps Manager for the current overlay and owner |
| iOS | Apps Manager/iOS report public 1.1.0 (33); staged 1.2.0 (34) is local/unuploaded and excludes wallet; installed Test 0.2.0 (62) has separately retained local-only deltas | Read native PRD/handoff and actual distribution receipts through Apps Manager |
| Android | Apps Manager reports Play 1.2.0 (15) installed/internal, production draft ready but submission held; managed publishing is off, so review approval would publish. General Live delivery is enabled and one Compact delivery/tap was verified. Play 15 source and consolidated Test 38 checkpoint are local-only; Test 41 is not reproducible from a clean clone | Read native PRD/handoff and current Apps Manager receipt; do not infer a rollout |
| Native documentation | Separate PRD/AGENTS/templates/checkers merged into main/dev; real missing-declaration FAIL and corrected PASS verified | Native repos and coordinator receipt; private-repository plan currently blocks mandatory protected-branch enforcement |
| Backups | Nightly encrypted off-host cycle at 03:15 Kuwait with isolated restoration verification; last success not freshly inspected by this documentation task | Original private successful receipt and backup/recovery runbook, not this policy table |
| Full regression | Plan exists; not executed by documentation/activation/handoff work | Run report bound to exact version only after an explicit full-run request |

Documentation activation evidence: Website [PR 178](https://github.com/malabdullah/barberplusplus/pull/178)
and [PR 179](https://github.com/malabdullah/barberplusplus/pull/179). Native
[iOS PR 45](https://github.com/malabdullah/barberplusplus-ios/pull/45),
[iOS PR 46](https://github.com/malabdullah/barberplusplus-ios/pull/46),
[Android PR 18](https://github.com/malabdullah/barberplusplus-android/pull/18) and
[Android PR 19](https://github.com/malabdullah/barberplusplus-android/pull/19)
require owner-granted private-repository access. Native handoff integration is recorded in [iOS PR 47](https://github.com/malabdullah/barberplusplus-ios/pull/47) and [iOS PR 48](https://github.com/malabdullah/barberplusplus-ios/pull/48). Later handoff-only commits can
supersede these document SHAs without changing the recorded application release.

## Active and held work

| Work | Owner / next source | Boundary |
|---|---|---|
| Website and shared backend changes | Website agent, native requests routed through Apps Manager | Use hosted Test; production actions remain separately authorized |
| Native iOS work and release state | iOS through Apps Manager | Preserve accepted build/device/signing/store scopes; staged does not mean public |
| Native Android delivery/verification | Android and Website through Apps Manager | Separate owner-approved Live push verification passed: one announcement to Compact build 15, tap opened Favourites, original preferences restored on device/backend. Website/Apps Manager verified original database firewall restoration and SSH closure at 12:47:34 Kuwait on 26 November; one Android announcement, zero iOS, original opt-out restored on both ends. Booking scheduler ran successfully without creating a booking or sending a booking alert |
| B-Wallet, UPayments, MyFatoorah, online/payment-choice pilots | Website Test branches and native Test scope via Apps Manager | Test-only; iOS Test 61/62 wallet work is isolated and requires its approved local-only delta transfer. Local/unuploaded staged iOS 34 excludes wallet. No Live promotion or public distribution follows from this work. |
| Written visit reviews, Help Center, Feature Requests | Product/owner future scope | Deferred; star ratings and Contact Support do not imply these features shipped |
| Native mandatory merge protection | Owner's GitHub account plan | Current private-repository plan limit; checks run but cannot block merges through protected branch/ruleset enforcement; no billing/visibility changes authorized |
| New machine/agent access | Owner and Apps Manager | Destination not selected; access/key migration and verification are a separate approved operation |

Local-only workspace/unfinished-work details and access categories are retained in
`.coordination-private/handoff-workspace-manifest.json` and
`.coordination-private/handoff-transfer-checklist.md`. Ask the coordinator for the
minimum relevant part. They include local state unavailable from a clean clone;
no public document should contain secret values or the private inventory itself.

## Known limitations and decision ownership

- This documentation pass is not a fresh all-feature acceptance, security audit,
  backup restore, real provider login, push send or deployment health campaign.
- A native repository clone alone does not reproduce installed iOS Test 62, Android Play 15/Test 38/Test 41 or every staged artifact: reconcile the platform-owned local-only source/build manifests before retiring the original Mac. No clean-machine build, custody transfer or signing transfer was performed for documentation acceptance. Checkpoint recovery on another machine is unverified unless its platform owner supplies an existing receiving-side proof; a source hash alone is insufficient.
- Actual Apple/Google prompts and native device behavior require their own real
  evidence; synthetic/unit success alone does not prove provider acceptance.
- Historical feature docs retain their original observations. Read their notices,
  the current PRD and version-matching code before treating a statement as current.
- Exact private access and independent recovery-key custody cannot be tested by
  exporting credentials during a documentation review. The owner/coordinator must
  approve a destination and transfer/verification scope.
- A dirty worktree, unmerged branch or private receipt belongs to its current
  task owner. Do not clean, merge or resume it based only on this snapshot.

## Refresh checklist

Record observation date/time zone, source ref, frontend release, backend/Functions
and migration identity, native build/channel/publication status, active task owner,
holds, actual backup/restore proof age and remaining verification gaps. Store only
nonsecret summaries here. Keep exact private IDs, data and access evidence in the
coordinator's private records. Update relevant PRD status only with appropriate
release evidence; documentation review is not release approval.
