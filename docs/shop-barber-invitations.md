# Shop barber invitations (hosted Test)

Managers invite a barber from **Barbers → Invite barber** using only an email.
No Auth identity or barber profile exists until the recipient finishes joining.
Existing customer emails require the manager's explicit confirmation; those
recipients sign in to their existing account. Staff emails cannot be invited.
The same customer ID, phone ownership and appointment history are preserved.

The link expires after seven days. Opening it does not consume it: the recipient
can resume an incomplete form. Successful acceptance consumes it atomically.
Resend rotates the secret and immediately invalidates every older link. Cancel
invalidates the pending invitation. Resend has a one-minute cooldown and each
invitation is limited to 20 generations. A manager can issue 30 invitations per
hour; the gateway adds per-IP limits. Delivery failure remains visible for retry.

The accepted barber initially has no services or approved hours and is inactive.
The barber submits working hours, individual breaks and vacations from Availability;
the manager reviews each through Availability requests. Services come exclusively
from that shop. Manager My Chair and administrator maintenance remain separate.

## Security and data

`private.shop_barber_invitations` stores the recipient email, shop, inviting
manager, SHA-256 token digest, expiry, delivery/status and accepted identity.
There is no client table access. `shop_barber_invitation_api` is executable only
by the server role; it rechecks live sessions, current roles and shop ownership.
The Edge Function derives actor/session from the validated bearer token and ignores
submitted actor IDs. Secrets travel in the URL fragment, are not returned to the
manager and are never stored as plaintext in the database. Only the current tab's
session storage retains the invitation and non-password draft while joining.

A new recipient's Auth identity is initially unconfirmed and marked for this
invitation. Atomic acceptance proves the original password, confirms email,
upgrades the trusted role, creates one barber and consumes the token. Interrupted
setup can retry using the original password; resend never deletes or resets an
account. Existing customers must authenticate as the invited identity. Phone
uniqueness remains enforced across people and shops; promotion reclassifies only
that same person's canonical phone claim, without merging by phone number.

## Deployment

Hosted Test uses Supabase `qvkucvcjmojjbphlzlks` and its existing gated Worker and
private inbox. Test invitations never send external email or SMS.
The frontend, three migrations and invite-barber Function must be deployed together.
Production is a separate approval/release: configure the Function's Resend sending
credential and verified `noreply@barberplusplus.com`, reply-to
`support@barberplusplus.com`, and allow the exact `/accept-invite` provider callback.
Do not copy Test mail capture settings or fictional identities to production.
Legacy already-issued Supabase Auth invitation links retain their existing password
setup screen, but managers can no longer pre-create ordinary barber profiles or
use the old destructive reinvitation endpoint.
