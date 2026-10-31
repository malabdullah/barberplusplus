# Customer Google and Apple sign-in in local Test

This integration is prepared only in the owned `barber-local-test` checkout.
No provider credentials, live Auth changes, deployment or public tunnel are
included. The integration is approved for dev validation. Both providers are currently disabled. The customer forms show the
provider buttons as unavailable until the local Auth service enables them.

## Customer journey

Customers can select Continue with Google or Continue with Apple from sign-up or
sign-in. The provider authenticates them, then returns to
`http://localhost:5173/customer/auth-callback`. The isolated customer client
exchanges the PKCE code; staff sessions do not process this callback.

A returning customer resumes booking or opens My account. A new customer with a provider-supplied name continues directly; if the provider does not supply a name, the customer is asked for one. No phone is requested during sign-in. A valid GCC phone is required before confirming a booking and is saved as profile contact information, without a verification code.

Accounts are not merged by phone, and appointment history is tied to the authenticated account. Existing phone-based accounts and bookings remain unchanged. Only trusted Google/Apple Auth identities with the customer role may complete this journey; staff sessions remain separate.

## Google setup

1. In Google Cloud, create a separate **Test** OAuth web application and configure
   its consent screen/test users. Do not reuse production credentials.
2. Add `http://localhost:5173` as an authorized JavaScript origin. If testing the
   frontend using `127.0.0.1`, add `http://127.0.0.1:5173` too.
3. Add the provider return URL **`http://127.0.0.1:55321/auth/v1/callback`** to
   authorized redirect URIs. This is the Auth callback; it is different from the
   frontend `/customer/auth-callback` route.
4. Place the Test client ID and client secret in the private local file below.
5. Run `node scripts/local-test.mjs configure-auth` from the owning checkout.
   It configures only the owned Auth container, retaining its exact image,
   networking and database. It does not restart Vite or reset data.
6. Refresh `/customer/sign-in`; Google becomes enabled when Auth reports it
   enabled. Exercise consent, cancellation, returning login, a missing provider name, a shared phone, account history and booking restoration.

Reference: [Supabase Google sign-in](https://supabase.com/docs/guides/auth/social-sign-in/auth-google).

## Apple setup

Apple web sign-in additionally requires an Apple Developer account, an App ID
with Sign in with Apple, a Services ID for web sign-in, and a signing key. Generate
the Apple client-secret JWT using the Team ID, Key ID and `.p8` signing key.
The **Services ID** is the web client ID; the `.p8` file itself is not the client
secret. Store the key privately and plan rotation before the JWT expires (Apple
web client secrets have a maximum six-month lifetime).

Apple needs a registered HTTPS provider return URL. Localhost alone is not
sufficient for its web OAuth callback. Before enabling Apple, arrange a controlled
HTTPS callback for this isolated local Test Auth service, forwarding only
`/auth/v1/callback`, including Apple's POST response. Register that exact domain
and URL with the Services ID and set it as `redirectUri` below. Do not expose the
whole local Supabase API or use the production callback. No forwarding service
has been created by this change.

The provider callback can be HTTPS while the frontend's final redirect remains
`http://localhost:5173/customer/auth-callback`; existing loopback guards on the
customer API are unchanged. Configure the Apple JWT/client ID privately, apply
local Auth settings, then test consent/cancellation, Hide My Email, missing name,
first login, returning login and booking with a phone. Apple may not supply a name;
the completion form always lets the customer enter it.

References: [Supabase Apple sign-in](https://supabase.com/docs/guides/auth/social-sign-in/auth-apple),
[Apple web configuration](https://developer.apple.com/help/account/capabilities/configure-sign-in-with-apple-for-the-web/).

## Private local configuration

Create `.local-test/customer-oauth.json` in the owning checkout with permissions
`0600`. This directory is ignored by Git. Start with just Google, or configure both:

```json
{
  "environment": "test",
  "google": {
    "clientId": "YOUR_TEST_GOOGLE_CLIENT_ID",
    "secret": "YOUR_TEST_GOOGLE_CLIENT_SECRET"
  },
  "apple": {
    "clientId": "YOUR_TEST_APPLE_SERVICES_ID",
    "secret": "YOUR_TEST_APPLE_CLIENT_SECRET_JWT",
    "redirectUri": "https://YOUR_TEST_AUTH_CALLBACK_DOMAIN/auth/v1/callback"
  }
}
```

Omit any provider not ready for use. Do not leave placeholder credentials enabled.
The local helper reads only this explicit Test configuration, validates its keys,
and never copies ambient production provider credentials. It does not put secrets
in `.env.local`, browser code, logs or Git. `local:start` reapplies these settings;
`configure-auth` applies them to the running backend without changing Test data.
Remove a provider from the private file (or remove the file entirely) and run
`configure-auth` again to disable it. Callback allowlisting is maintained locally.

## Validation boundary

Automated UI/service tests exercise form behavior, disabled providers, configured
provider launch, PKCE callback handling and missing-name completion. SQL tests cover
provider/customer roles, session isolation, phone-independent ownership and session revocation. The synthetic social integration
probe uses real local Auth sessions plus server-created provider identity fixtures.
It tests the gateway and data flows, not Google/Apple authorization servers.

Real provider OAuth remains pending Test credentials and Apple's HTTPS callback.
Email signup/login/recovery and signed-in booking were exercised in the browser;
desktop/Arabic visual acceptance remains pending. No successful Google or Apple consent
flow is claimed until those are exercised.
