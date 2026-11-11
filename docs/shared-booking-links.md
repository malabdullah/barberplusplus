# Shared booking links

Implemented on hosted Test only. Main and production must remain unchanged until owner acceptance.

The account appointment's More → Share booking details and checkout confirmation open the shared-link dialog. Share link uses Web Share with a URL, Copy link is the fallback, Preview opens the read-only appointment and Stop sharing revokes it. Reopening sharing retains the same active URL. Creating a new link after revocation never revives an old link.

The page uses the public Barber++ header, theme, languages and a focused appointment card. It shows current shop/barber identity, purchased services/package, Kuwait date/time/end/duration, price, status, reference, directions and calendar. No customer identity, contacts, notes, internal cancellation reason, management actions or account/claim capability is returned. It refreshes on entry, foreground/focus, explicit Refresh and once per minute while visible. Keyboard Skip to content preserves the token fragment.

## API and access

New `booking-share` Function uses existing exact environment/origin/Test gateway guards. Every management request validates a live customer-capable Auth session, then SQL resolves the canonical account and indexed booking ownership. Guests can manage a newly created guest booking from its original unexpired sealed receipt, under the existing one-hour receipt deadline; matching email alone never proves ownership. Signed-in owners manage through their account afterwards. Neither guest contact is asserted verified.

- POST `create`, `bookingId`, optional private `receipt` → `{url, expiresAt}`.
- POST `revoke`, `bookingId`, optional private `receipt` → `{sharing:false}`.
- POST `view`, `token` → `{booking:<whitelisted appointment>}`. No account is required to view; hosted Test still requires its existing environment access gate.
- All endpoint responses are no-store/no-referrer/noindex. Invalid, revoked, reassigned and expired links return the same LINK_UNAVAILABLE response. No mutation is possible with a viewing link.

`/booking/share#<64 hex token>` keeps the token out of HTTP page URLs, referrers and chat-preview requests. Tokens derive from a random link UUID/nonce under a separate HMAC namespace; only its SHA-256 hash and nonce are saved in the private RLS table. Exact indexed hash lookup is service-only. A server credential rotation changes the reconstruction key. Existing public tokens still require explicit revocation or expiry; operators must reconcile and rotate link rows during that maintenance. Never expose a server key to restore a link.

Only the owner-authorized RPC response permits reconstructing an existing active URL. User-supplied identity fields are discarded by the Function. No receipt, bearer, contacts or token is logged by the feature or embedded in previews. Do not introduce analytics or third-party scripts on this route.

Expiry is 24 hours after the current appointment end in Kuwait time, so an ordinary reschedule updates both displayed details and expiry. Customer reassignment and guest/account ownership changes invalidate old links. Completed/cancelled status remains visible until expiry; cancelled/no-show appointments cannot be added to a calendar from this view. Browser screenshots/copies already taken by recipients cannot be revoked.

## Deployment

Additive migration `20261111040859_customer_booking_share_links.sql`; no existing account/history dispatchers or notification runtime settings are replaced. Service-only `public.customer_booking_share` and private `customer_booking_shares` table are added. `supabase/schema.expected.sql` tracks the new public routine.

Deploy the new Function, preserve its own origin/owner/capability authentication (`verify_jwt=false`), then the hosted Worker allowlist/UI. Preserve Worker secret bindings. A second generic HTML entry has only public brand metadata; production Nginx routing/noindex/no-store/no-referrer support is prepared in source, not deployed to production. Hosting Test remains gated; chat unfurlers without gate credentials will not display its preview. Messaging apps control their own preview caching.

No iOS work is included. The pending native history patch and native email/contact handoff remain separate.

## Related claim-path fix found during acceptance

The actual service-role guest-to-account claim failed on hosted Test because its invoker routine directly read Auth users, a permission not granted to that role. Forward migration `20261111042039_guest_email_claim_permission.sql` keeps the public routine invoker/service-only and moves only the already receipt-bound, verified-email equality to a private boolean security-definer helper with an empty search path and no client grants. It does not grant Auth-table access or turn an email into ownership proof. The existing live-session, sealed-receipt, exact-booking and account checks remain. A real synthetic API claim must pass as part of acceptance.
