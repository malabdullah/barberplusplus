> **Versioned feature contract / historical phase record.** The original status,
> approval limits and verification results below belong to their stated phase.
> Read [the current handoff](handoff.md), [product/status inventory](../PRD.md)
> and source matching the target release before using these details. Earlier
> Test-only/pending wording is not today's deployment status or a new execution grant.

# Manager onboarding follow-ups — hosted Test

Scope: separate `codex/manager-onboarding-followups-test-20261125` worktree/branch, based on the current Test booking-completion source. Main and production are excluded. Existing B-Wallet, UPayments and MyFatoorah Test pilots are preserved, not promoted.

## Changes
- Setup Team offers Invite barber, Managed barber and I also work as a barber.
- Managed creation targets the owned wizard shop and preserves return navigation through profile, hours and settings. The profile has no login credentials; manager sets its hours directly.
- New invited barbers can use Google or Apple as well as the existing email/password registration. The invitation remains in session storage, never in the provider callback URL. Matching signed-in accounts complete without a second password/account. Wrong-account, cancelled sign-in, expired invitation and unavailable browser storage are handled.
- Removed duplicate setup back links in the affected manager pages.

## Verification
- Full frontend suite: 107 files / 593 tests passed.
- ESLint and cloud-Test build passed. Existing chunk/Recharts warnings remain. Local Node is 24.9.0; pinned 24.20.0 CI has not been claimed.
- Hosted barber-test rollback SQL passed: synthetic Google/Apple post-provider accounts, matching identity acceptance, wrong identity rejection, single-use invitation, unchanged Auth account/provider, inactive barber pending hours, managed creation without Auth account and direct hours. All synthetic writes rolled back.
- Ordinary browser: existing synthetic manager, wizard Team has all three actions, managed form preselects the mode and returns to setup on Cancel. No records submitted or altered. Mobile 390px, English/Arabic, light/dark checked with no horizontal overflow; original language/theme and viewport restored.
- Real Google/Apple authorization prompts were not executed. The SQL models verified provider facts and does not replace a real provider sign-in test. Apple Hide My Email must match the invited address, otherwise account mismatch is deliberately blocked.

No database migration or Edge Function deployment is required for these frontend changes. The coordinator-owned Test customer-auth v50 remains untouched. No persistent fixtures, external messages or payment transactions were created.

## Owner test
1. Open hosted Test → manager → Shop setup → Team → Managed barber.
2. Add name and shop services, then set hours. Confirm return to setup and no barber credentials/invitation.
3. Invite an unused email, open the Test invitation in a separate signed-out session and choose Google/Apple using the invited email. Complete details and confirm the same account joins the assigned shop.
4. Try a different provider email: it must ask for the invited account rather than attach the wrong person.
