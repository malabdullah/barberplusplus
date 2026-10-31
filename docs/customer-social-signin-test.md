# Customer Google and Apple sign-in in local Test

This integration runs only in the owned `barber-local-test` checkout. Provider
credentials are private local state and are never included in Git. The customer
forms show provider buttons as unavailable unless the local Auth service enables
them. No production Auth configuration or application deployment is involved.

On 2026-10-31, separate Google and Apple Test registrations and a callback-only
Cloudflare Tunnel were activated with the owner's approval. Google uses project
`barber-plus-plus-auth-test`. Apple's Services ID is
`com.barberplusplus.authentication.test.web`, associated with primary App ID
`com.barberplusplus.authentication.test` under team `D49RFZQ6BT`. Its dedicated
key ID is `SPT3287JRA`. Existing provider registrations were not modified.

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
whole local Supabase API or use the production callback.

`node scripts/customer-oauth-callback.mjs` provides this restricted relay on
`127.0.0.1:55329` after the private Apple configuration exists. It reads the
callback hostname from that configuration and forwards only GET/POST requests
to the fixed local Auth callback. Other paths, hosts and methods are rejected;
request credentials are not forwarded, responses cannot redirect outside the
local customer callback, and callback contents are never logged. The relay
requires state plus a provider code/error; Auth still verifies the signed state,
provider response and PKCE flow. It has no service-role key.

A Cloudflare Tunnel must use a single ingress rule for the exact registered
hostname and `^/auth/v1/callback$`, targeting `http://127.0.0.1:55329`, followed
by a catch-all `http_status:404`. Registering an unused Test DNS name and starting
this tunnel exposes that callback only; it must be explicitly approved before
activation. Tunnel credentials belong in private local state, outside Git.

The approved local installation uses `auth-test.barberplusplus.com` and tunnel
`barber-local-test-auth` (`3a937a5d-b7ee-471b-9990-36281d13eaef`). It has no
private-network routes. Two user LaunchAgents, alongside the existing Test
startup service, keep the relay and tunnel running after login:
`com.barberplusplus.local-test-oauth-callback` and
`com.barberplusplus.local-test-oauth-tunnel`. Their plists are in
`~/Library/LaunchAgents/`; logs are private files in
`~/Library/Application Support/Barber++ Test/`. Stopping these two agents does
not stop Test or remove its database. To disconnect the public callback, boot out
the tunnel agent; preserve its plist for an intentional later restart. To retire
it permanently, also remove only this Test CNAME and tunnel after approval.

The initial Apple client secret expires on **2027-03-30**. Before that date,
generate a fresh ES256 client-secret JWT from the private Test key, Team ID and
Services ID (maximum six months), replace only `apple.secret` in the private
configuration, and run `configure-auth`. Do not create a replacement App ID or
reuse a production key to rotate this secret.

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

Local startup and `configure-auth` also verify the owned Functions runtime and
its customer gateway. `ensure-functions` can repair a stopped runtime without
restarting Vite or changing data. The installed Test supervisor checks it every
30 seconds, including while Vite is running; the runtime also uses Docker's
`unless-stopped` restart policy. Checkout/project ownership guards apply before
any container is started or updated.

## Validation boundary

Automated UI/service tests exercise form behavior, disabled providers, configured
provider launch, PKCE callback handling and missing-name completion. SQL tests cover
provider/customer roles, session isolation, phone-independent ownership and session revocation. The synthetic social integration
probe uses real local Auth sessions plus server-created provider identity fixtures.
It tests the gateway and data flows, not Google/Apple authorization servers.

Both provider launch endpoints have been checked against real Auth, including
their exact redirect URIs and minimal scopes. The public callback rejects other
API paths, and invalid signed state returns to local Test with an Auth error.
Real Google consent, account creation without a phone, returning sign-in and
customer sign-out passed in the browser. Real Apple consent with Hide My Email,
phone-optional account creation, returning sign-in and customer sign-out also
passed. Returning Apple sign-in reused the existing profile and hidden address.

The Apple customer completed synthetic Test booking `C98E190B5A`. Blank and
invalid phones were rejected, a valid GCC contact number was saved without phone
verification, the booking appeared in the customer's private appointment history,
and the next booking reused the saved phone. Reloading the account retained the
phone and appointment. Database checks verified account-based ownership and that
the phone was not marked verified in Auth. Existing accounts/bookings were
preserved. No second booking was submitted during the saved-phone check.

Email signup/login/recovery and signed-in booking were exercised in the browser.
English and Arabic provider wording and RTL layout were checked on desktop and
at a 390px mobile viewport, including equal 50px button heights, the multicolour
Google mark and white Apple mark on black. Full project checks and the local
email/social integration probes passed. These results apply to local Test only;
no production provider activation or deployment is covered.
