# Super Admin and Admin — hosted Test acceptance

Date: 15 November 2026. Application source: `4c01bb8935dfd88a632c2a40bf124cdfd429a5d8`.
Test: https://barber-test.alabdullah-cs.workers.dev. Supabase: `qvkucvcjmojjbphlzlks`.

## Result

The former Admin is displayed as **Super Admin**. The former Agent is displayed as **Admin** and uses the full administration workspace. Administrative-account management is reserved to Super Admin.

Stored Auth role codes remain compatible: `admin` means Super Admin and `agent` means Admin. No existing login identity, password or provider link was migrated. Both administrative roles require verified two-factor authentication before gaining administrative access.

Only the isolated feature branch was committed. Remote dev remains `caa3caa95dd538c3a4149d7b53544a7763974906`; main remains `0c0e15b60aac6159e79625aef71ef55091580450`. Production and native applications were not deployed.

## Access

| Capability | Super Admin | Admin |
| --- | --- | --- |
| Administration dashboard, ordinary managers/barbers, branches, configuration, audit, communications | Yes | Yes |
| Global booking rules, private shop reviews, platform activity and branch-manager transfers | Yes | Yes |
| Create/grant Admin access or suspend/reactivate Admin access | Yes | No |
| Change administrative-account emails or reset another Admin's password | Yes, subject to existing protections | No |
| Suspend Super Admin or create another Super Admin through this page | No | No |

The Super Admin route is **Users → Administrators** (`/admin/users/administrators`). It grants Admin to an existing verified dedicated customer account, preserving the account identity and requiring a fresh sign-in and MFA. It rejects existing staff assignments, linked social-alias accounts, unverified email, duplicate grants and unsupported role actions. It creates no new password or Auth identity.

The ordinary Admin has no Administrators link; direct navigation redirects to its dashboard, and direct API calls return `SUPER_ADMIN_REQUIRED`. Administrative identities are excluded from the Admin email/password tools. Ordinary manager suspension cannot be repurposed to target administrators.

## Verification

- Full `npm run check` passed: frontend 423 tests, Functions 253 tests, operations 69 tests; lint, Functions type checks, migrations, domain checks and production build passed.
- Hosted Test: 16 SQL regression suites passed, including the final 57 hierarchy checks. Fixtures and their mutations rolled back.
- Additional lower-Admin variants passed manager-transfer, booking-policy, publishing and both announcement suites. One optional duplicate lower-Admin availability replay expired at the tool confirmation step and was not counted. The standard availability suite passed 56 checks.
- 22 distinct browser acceptance scenarios passed: MFA enrollment/sign-in for both roles, granting Admin, hidden navigation, deep-link and direct API denial, administrative-email isolation, suspend/reactivate and old-session denial, desktop light/dark, mobile, Arabic, hosted password-reset/account-tools/admin-push reads and the correct Settings return path.
- The four changed Functions and the exact frontend commit were deployed to Test. The access gate, gateway secret bindings and private inbox were preserved. No notification or external email was sent.
- All four new migration tracking versions match the committed source filenames following the owner's explicit approval.
- Both approved disposable QA accounts, their credentials and factor material were removed. Auth account count returned to 483. Shop, booking and canonical account-link hashes match the pre-change values. The complete Auth-row hash changed during the wider Test session; no existing account was edited by these migrations, and it was stable before and after this run's browser QA.
- Advisors were reviewed. New callable helper/management routines are intentional authenticated APIs, protected by live role, session and MFA checks; their denial paths are covered. Existing private-table no-policy and password-protection advisories remain outside this feature.
- The clean-seed baseline helper assertion was updated for the new live-role implementation. A new local/Docker database replay was not started; the owner's required runtime target was hosted Test.

## Owner test

1. Sign in on Test using the existing administrative account and its authenticator. The sidebar should show **Super Admin**.
2. Open **Users → Administrators**. Existing Agent accounts should show **Admin**.
3. For a new grant, first create and verify a separate customer email account, then enter that email and confirm **Add Admin**.
4. Sign in with that account at the team sign-in page. Complete MFA enrollment. It should open the administration dashboard with **Admin** in the sidebar.
5. Check normal administration pages; confirm **Users** has no Administrators card. Opening the protected URL should return to the dashboard.
6. As Super Admin, suspend/reactivate that test Admin. An ended session must stay denied until a fresh sign-in.

No production promotion is included in this acceptance.
