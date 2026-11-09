# Customer password security and native handoff

Status updated 2026-11-09: the shared website password flow is released to
production. PR #64 published the security flow; the currently served production
runtime is `d0de7dde212fd0cfda0ddc950783a0bed3dfe514`. Read-only inspection of
its actual JavaScript confirms the current-password, password-status,
password-change and verified email password-setup contracts. The owner has now
authorized the iOS agent to implement the corresponding native screens and
security handling on Test. The older Test-only hold below is historical.

Do not equate website publication with native-device acceptance: native recovery
v2 callback/session compatibility must still be verified against production
before enabling that native path there. Preserve the independently deployed
native Test compatibility layer. Do not deploy or overwrite native backend
helpers based only on this document; reconcile the actual installed contract.

The owner requested website/shared-backend changes first, then an iOS adaptation
with consistent UX. Production starting point is c5a23f7. Current hosted Test
customer-auth v18 has private-review support but lacks the previously tested
native push dispatch and native callback additions. Reconcile those additive
contracts from ios/backend/hosted-test/push-20261105; never deploy that older
snapshot wholesale. Keep APNs configuration, dispatcher, preferences and owner
records unchanged. Main and production stay unchanged during Test implementation.

## Intended user flows

- Signed-in password-capable account: **Change password**, with Current password,
  New password and Confirm new password. Derive identity from the live session;
  no email entry. Verify the current Barber++ password, not an Apple/Google
  password. Capability comes from trusted Auth storage and remains true when the
  last login used a linked social identity.
- Provider-only account: explain that Apple/Google manage their own passwords.
  Optional **Set a Barber++ password** verifies the account's current confirmed
  email first. Adding a password preserves the linked provider identities.
- **Forgot password** remains an independent email recovery flow. Codes and links
  exchange through the server before issuing a short-lived, one-use password
  proof. A normal logged-in session is not a recovery proof.
- Successful credential changes sign out all sessions of the shared identity,
  including work/customer modes. No role or account ownership changes.

## Required server boundaries

Use the pinned Auth API for password verification/hash updates. Service-only
proof records bind user, session, purpose, expiry and existing credential state.
A fresh password reauthentication session is consumed for signed-in changes.
Recovery/set proofs require a server-issued, email-bound request and successful
Auth OTP verification. Preserve uncertainty guards after unknown Auth failures;
never retry an uncertain update blindly.

Auth password writes for customer/manager/barber accounts must carry a one-use
server-only app_metadata operation marker. A database trigger checks it, removes
it before storage, consumes the proof and revokes sessions atomically. Browser
user_metadata cannot authorize writes. Preserve the existing administrative
reset path through its trusted guard and do not change the protected admin.
Adapt staff recovery and invitation password setup to the same proof boundary.

Chain the existing hosted Test PostgREST pre-request guard rather than overwriting
it. Production must also reject revoked shared-account sessions at Data API/RPC
boundaries. Privileged manager Functions need the equivalent live-session check.

## Native callback contract being finalized

Never accept a client-selected callback URL or scheme. The server selects exact
website bridge/callback URLs and environment-specific native schemes. Native
requests include client=ios and a UUID nativeState; bind the state and email
request server-side. Preserve native state checking in the future client.
Test schemes/credentials must not be enabled in production. The final document
will list precise API fields, errors, versions and live verification evidence
before authorizing iOS work.

## Shared API contract (original Test verification, 2026-11-06)

Website: https://barber-test.alabdullah-cs.workers.dev/customer/password
Test project: qvkucvcjmojjbphlzlks only. customer-auth v20, admin-password-reset
v5, invite-barber v4, cloud-test-inbox v4. These are historical **Test version numbers**, not production versions.
The iOS implementation is now authorized on Test; see the updated status above.

- `password-status` uses the live shared identity and returns `hasPassword`,
  `providers`, `email`, `canVerifyEmail`. Do not infer capability from last login.
- `password-change`: currentPassword, password, confirmPassword. No email/user ID
  is accepted as identity. Verify the current Barber++ password on the server.
- `password-setup-request`: authenticated; derives current confirmed email.
  Optional `audience: work` selects the work sign-in return. A verified email
  recovery challenge issues the short-lived set-password proof.
- `email-recovery`: email, returnTo (`/book` or account), optional audience work.
  Always use the returned requestId for subsequent code/link verification.
- `password-recovery-verify`: requestId and either the email code or tokenHash.
  Returns the Auth session and a one-use proof, expiresIn 300 seconds. The web
  stores only the opaque proof/expiry in sessionStorage, never passwords/codes.
- `email-reset`: authenticated recovery session, proof, password, confirmPassword.
  Normal customer/work sessions are insufficient. Success returns
  `signInRequired: true`; clear all cached account/work sessions and require a
  fresh sign-in. The database revokes every Auth session of this same identity.
- `password-invite-verify`: tokenHash. The server binds the pending invitation,
  permits GoTrue's unknowable temporary-password bootstrap only during that
  exact confirmation transition, then issues a separate chosen-password proof.
  Password save atomically marks the pending barber assignment accepted.
- Preserve linked Google/Apple identities, work roles, canonical customer
  references, bookings, native push configuration/master/category preferences.
- On PASSWORD_UPDATE_UNCERTAIN do not retry the credential write. Clear local
  credentials and let the user sign in again or start a fresh recovery flow.

### Native recovery v2

Before sending `email-recovery`, generate and securely retain a random verifier
(43–128 URL-safe characters), its SHA-256 base64url challenge (43 characters),
and a UUID nativeState. Include `client: ios`, nativeState, nativeChallenge.
Do not put the verifier in email, URLs, logs or public storage.

The server chooses the own-site callback; callers cannot choose redirect hosts.
The email bridge obtains an opaque one-time deliveryToken through
`password-native-delivery` using requestId, nativeState and the emailed hash.
The native deep link contains **state, type=recovery, request_id,
delivery_token**, never an Auth token/hash or the verifier. Test uses
`barberplusplus-test://email-callback`; production will use
`barberplusplus://email-callback` only after deployment verification.

The app must check local pending state and send `password-recovery-verify` with
client ios, requestId, nativeState, nativeVerifier and deliveryToken (or manually
entered email code). Wrong device verifier/state and reused requests fail closed.
Only store the returned Auth credentials in the normal secure keychain, and keep
the password proof transient. An older app without nativeChallenge receives
NATIVE_CLIENT_UPDATE_REQUIRED rather than silently falling back to web recovery.
Native signup confirmation retains its existing token_hash return contract;
only recovery uses this v2 proof protocol. Update the client's shared-account
sign-out, local caches and biometrics for the resulting all-device revocation.

### Evidence so far

- 33 hosted SQL security assertions, 14 appointment-action regression assertions
  and 13 rating assertions passed (Test's optional review field retained).
- 21 actual Auth/API scenarios across customer/manager/barber change/recovery;
  eight provider-only/native scenarios; six invitation scenarios passed.
- 170 application unit tests, Function tests and 62 operational tests passed.
  Native push handler's four existing regression tests passed unchanged.
- English dark and Arabic light layouts inspected on hosted Test at a narrow
  viewport; owner language/theme restored. Protected admin Auth fingerprint
  unchanged. Health advisors empty; private proof RLS intentionally denies all
  direct table access, including service clients; only bounded RPCs can act.
- Production schema replay/required CI and production deployment remain pending.
