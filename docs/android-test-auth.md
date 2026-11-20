# Android Test authentication return contract

Test-only integration. Production, the existing iOS client and the browser
authentication contract are unchanged. A deployed backend alone is not native
acceptance: wait for the coordinator's READY checkpoint and approved fixtures.

## Origins and client identity

- Website/API gateway: `https://barber-test.alabdullah-cs.workers.dev`
- Backend: Supabase `qvkucvcjmojjbphlzlks` only.
- Separate return host: `https://barber-auth-test.alabdullah-cs.workers.dev`
- Android package: `com.barberplusplus.customer.test`.
- Association SHA-256:
  `2B:7A:E1:06:E0:10:CF:B7:C9:4C:3B:0B:EA:36:20:5F:AB:66:35:BF:92:CF:DE:0A:AA:FB:EB:26:77:84:11:94`.

Every Android email/password request must explicitly use `client: "android"`.
The server enables this client only when all three environment/origin/backend
pins match Test exactly. It must never use `client: "ios"`, an iPhone custom
scheme, a Live URL or another project's OAuth audience as a workaround.

## Device binding

Before signup or password delivery, generate a cryptographically random UUID
`nativeState` and a random base64url verifier, 43–128 characters. Persist both
privately in the app's pending flow before opening an external browser. Send
`nativeChallenge = BASE64URL(SHA256(ASCII(nativeVerifier)))`, without padding.
Persist the original verifier until completion or explicit abandonment; do not
regenerate it during process recreation, polling, resend or callback handling.

Server verification derives the hash from `nativeVerifier`; a caller-supplied
challenge cannot override it. A link copied to a different installation cannot
complete the original flow without that installation's verifier.

## New email account

All actions use the existing `customer-auth` gateway and normal Test access
authorization. Credentials and provider tokens must not enter logs or analytics.

| Action | Additional fields | Result |
| --- | --- | --- |
| `email-signup` | `name`, `email`, `password`, `nativeState`, `nativeChallenge` | `success`, `requestId`, `pendingHandle`, `expiresIn` (3600 seconds) |
| `email-native-status` | `requestId`, `pendingHandle`, `nativeState`, `nativeChallenge` | `status`, remaining `expiresIn`; no identity/session |
| `email-resend` | same binding/handle as status | same request ID, remaining expiry; no extension |
| `email-native-verify` | `requestId`, `nativeState`, `nativeVerifier`, exactly one of `code` or `deliveryToken` | matching `session` and canonical `profile` |

Keep `requestId` and `pendingHandle` privately with the verifier. A generic
signup response does not prove a new account was created: occupied or ineligible
addresses receive the same response, without changing their password or role.

Verification codes are 6–10 digits. Do not mix code and delivery handle, send
raw `tokenHash` to app verification, or substitute another pending request.
Only a definitively invalid code allows another attempt within normal limits.
An uncertain provider result closes that attempt; do not repeat the write
automatically. The app can explicitly request another captured email if allowed.

The normal Auth-generated Test email points at the existing website callback.
That page exchanges the provider credential for an opaque UUID delivery handle,
then displays an explicit Open app link:

`https://barber-auth-test.alabdullah-cs.workers.dev/auth/email?requestId=UUID&state=UUID&delivery=UUID`

Android validates exact HTTPS origin/path, unique allowlisted fields, UUIDs and
matching stored state/request before submitting the delivery handle with its
stored verifier. Never adopt a browser-provided session. Persist a returned
session only after successful bound verification. Reject late/foreign/replayed
callbacks without replacing an existing user's session.

The browser fallback redirects to a fixed instruction page without forwarding
the delivery handle or consuming a session; it never loops back to the helper.

## Passwords

The existing `password-status`, `password-change` and proof-based `email-reset`
contract still applies. Current-password change requires the current password;
successful changes revoke all sessions. An uncertain change must end the local
session and must not be replayed.

For Android `email-recovery` and `password-setup-request`, send the device
binding above. Setup requires the signed-in account and derives its email on
the server. Recovery returns generic success for unknown addresses. Verify with
`password-recovery-verify`, `client: "android"`, `requestId`, `nativeState`,
`nativeVerifier`, and exactly one of `code` or `deliveryToken`. The result
contains a short-lived proof and the matching verification session. Submit that
proof with the matching session to `email-reset`; do not use the earlier session.

Recovery email callbacks use the same helper `/auth/email` path. The app's
privately stored flow determines whether to call signup or recovery verification;
the URL is not authority to change the stored purpose.

## OAuth return helper

The only Supabase redirect addition is
`https://barber-auth-test.alabdullah-cs.workers.dev/auth/oauth?state=*`.
The HTTPS host, path and parameter name are fixed; only the app's state value
varies. GoTrue v2.197.0 matches the entire redirect URL including its query, so a
bare path entry cannot accept this state-bearing redirect. Native OAuth uses
PKCE and matches its original app state/verifier independently from the
provider's Supabase-managed OAuth state. The
helper accepts only `state` plus a bounded code, or a bounded provider denial.
It rejects session tokens, arbitrary destinations, duplicate parameters and
unrecognized paths. Its fallback drops all codes/errors and returns to the
fixed Test sign-in screen. No personal Google/Apple authorization is included
in ordinary fixture checks.

The helper serves only the single Test Android association. It does not serve
`/book` or Apple association files, and does not activate Live app links. Query
strings are redacted from helper logs/traces; invocation URL logging is off.

## Acceptance and coordination

Keep the approved first guest's original booking/proof/journal through its
separate retention deadline, and its minimal closed-key marker indefinitely.
Later A/B/C/D fixtures and action budgets are separate. The current C fixture is
email-only, but GoTrue generated an unknown temporary password during creation.
Its native first-password and name-completion cases are held; they have not
passed. No provider identity is fabricated and no password guard is bypassed.
D is created once
through the actual signup flow rather than seeded. Read-only protocol metadata,
synthetic transaction tests and helper smoke checks do not count as successful
native sign-in or push delivery.

All assignments, private credential references and READY/results handoffs go
through the coordinator. No client key, password, code, token or private link
belongs in chat, source, command arguments or report artifacts.
