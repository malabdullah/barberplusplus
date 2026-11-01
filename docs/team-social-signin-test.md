# Team sign-in and manager social identities

The customer and team sign-in pages share the same public authentication shell,
form controls, provider buttons, theme behavior and English/Arabic layout. Email
and password remain available for all existing staff roles. Google/Apple on team
sign-in accept existing managers only; they do not register or promote managers.

The provider transaction uses a separate sessionStorage PKCE client and the
`/team/auth-callback` route. Only a confirmed, server-verified manager with the
selected provider identity can install a staff session. Customer sessions remain
isolated. Canceled, expired, missing and replayed transactions are rejected.

Managers can connect a different-email provider from **Settings → Google & Apple
sign-in** after authenticating normally. Linking requires the original manager ID
before and after the callback. A provider identity already belonging to a different
account cannot be reassigned through this UI. No roles, shop ownership or RLS
policies are changed.

Hosted Test requires this exact redirect allowlist addition:
`https://barber-test.alabdullah-cs.workers.dev/team/auth-callback`.
Different-email connection additionally requires Supabase's **Allow manual
linking** setting. The owner must approve enabling this additional authentication
method. Test remains project `qvkucvcjmojjbphlzlks`; production configuration and
provider registrations are not updated by a Test deployment. Keep the private
hosted config file in sync without overwriting the renewed Apple credential.

The existing Google/Apple Test registrations still return through the same
Supabase provider callback. No additional provider secret is required. A real
manager provider connection needs the owner to authenticate with an identity not
already attached to a Test customer. Automated callback/role tests cannot prove
that final external-provider interaction.

The owner approved manual linking on 2026-11-01. It is enabled in hosted Test;
all five exact Test redirect URLs are retained, including the new team callback.
