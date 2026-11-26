> **Versioned feature contract / historical phase record.** The original status,
> approval limits and verification results below belong to their stated phase.
> Read [the current handoff](handoff.md), [product/status inventory](../PRD.md)
> and source matching the target release before using these details. Earlier
> Test-only/pending wording is not today's deployment status or a new execution grant.

# Super Admin and Admin — hosted Test acceptance

Date: 15 November 2026. Deployed application source: `2d959892c9ab331cb7b578f98087002f45d1932d`.
Test: https://barber-test.alabdullah-cs.workers.dev. Supabase: `qvkucvcjmojjbphlzlks`.

## Result and owner test

Super Admin now creates an Admin directly through an email invitation. Customer signup or promotion is no longer part of this flow.

1. Sign in to Test with the existing Super Admin account and authenticator.
2. Open **Users → Administrators**.
3. Enter a name and a new, unused email address; select **Add Admin**.
4. Open **Test email inbox** in the Test banner and open the captured invitation. Test does not send a real email.
5. The recipient sets their own password, then enrolls two-factor authentication and enters the Admin workspace. No customer profile is created.
6. As Super Admin, use **Edit** for name/email and **More** for password reset, suspension/reactivation or deletion. Pending invitations have **Resend invitation** and **Cancel**.

Invitations expire after seven days and work once. Resending invalidates the previous URL; cancelling invalidates the invitation. An occupied email gives a clear error rather than converting an existing account. Opening an invitation while another account is signed in does not replace that account silently.

## Permissions and safeguards

Stored roles remain compatible: `admin` is Super Admin and `agent` is Admin. Both require live-session validation and verified MFA for administrative access. Existing passwords, provider links and authenticators are preserved.

| Capability | Super Admin | Admin |
| --- | --- | --- |
| Ordinary administration, managers/barbers, branches, configuration, audit and communications | Yes | Yes |
| Booking rules, private reviews, activity history and manager transfers | Yes | Yes |
| Invite, edit, reset password, suspend/reactivate or delete Admin accounts | Yes | No |
| Manage Super Admin accounts through this page | No | No |

The protected route and direct API calls enforce Super Admin permission. Email changes, password resets and suspension end affected Admin sessions. Reactivation does not revive ended sessions. Deletion is confirmed by name, revokes access and preserves audit history. The private invitation service cannot be executed by browser roles. Acceptance installs the recipient's final password, verified email and Admin role atomically, including interrupted/concurrent signup safeguards.

## Verification

- **22 hosted browser scenarios passed**, covering invitation acceptance, password and MFA setup, duplicate email, wrong-account protection, single use, cancellation, resend/replacement URL in the same tab, editing, reset, suspension/reactivation, deletion, mobile, Arabic, light and dark themes.
- **433 frontend tests across 85 files passed**. The complete implementation check also passed 261 Function tests, 69 operations tests, lint, Function type checks, migration/domain checks and build. The final URL replacement fix passed the final frontend suite, lint and cloud build. Gateway checks passed 8/8.
- Hosted database checks passed: **52 direct-invitation**, **57 hierarchy**, and **27 account-email** assertions. These transactional fixtures rolled back.
- The actual deleted QA Admin's open session was denied and its deletion audit event remained. It had no customer profile; pending invitations created no Auth accounts.
- Exact deployed frontend source and Test access gate were read back successfully. The new Function and three migrations are deployed to Test. The two approved tracking corrections are complete. The session-revocation source filename matches its existing applied timestamp without rewriting that history.
- Advisors were reviewed: private tables intentionally deny direct access; guarded management APIs intentionally allow authenticated execution. Existing broader private-table and password-protection notices remain outside this change.

## Cleanup and boundaries

The approved run's three invitations, four captured emails, temporary deletion jobs, sessions, MFA factors, local passwords and URL secrets were removed. The invited Admin fixture was permanently removed. The QA Super Admin was anonymized and soft deleted, retaining a non-login audit actor tombstone because the existing audit actor foreign key cascades on permanent deletion. All 13 audit events remain, including the Admin deletion event. There are zero active QA accounts or remaining QA invitations/emails.

Shop, booking and canonical customer-link hashes match before and after cleanup. Existing owner accounts and the protected Super Admin were untouched.

Only the isolated feature branch was committed; no branch was pushed. Remote dev remains `caa3caa95dd538c3a4149d7b53544a7763974906`; main remains `0c0e15b60aac6159e79625aef71ef55091580450`. Production, native applications and App Store submission remain unchanged.

Machine-readable evidence: `artifacts/direct-admin-management-2026-11-15/acceptance.json` and `browser-scenarios.json`. Older hierarchy artifacts describe the superseded customer-promotion flow and are retained only as historical evidence.
