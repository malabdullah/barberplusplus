# Shared booking links

Implemented on hosted Test only. Main and production must remain unchanged until owner acceptance.

The account appointment's More → Share booking details and saved-account checkout confirmation open the shared-link dialog. Past/cancelled appointments retain sharing controls until the link's expiry, so owners can still revoke. Guest checkout must first save the booking to an account before the website offers persistent sharing; receiving a shared link never requires an account. Share link uses Web Share with a URL, Copy link is the fallback, Preview opens the read-only appointment and Stop sharing revokes it. Reopening sharing reuses an unexpired URL only when the public appointment details are unchanged. Sharing after a public detail changes creates a new immutable version; previous URLs keep their original details. Creating a new link after revocation never revives an old link.

The page uses the public Barber++ header, theme, languages and a focused appointment card. It shows the shop/barber identity, purchased services/package, Kuwait date/time/end/duration, price, status, reference, directions and calendar captured when that URL was created. Calendar and directions use that saved version too. No customer identity, contacts, notes, internal cancellation reason, management actions or account/claim capability is returned. It rechecks access on entry, foreground/focus, explicit Refresh and once per minute while visible; a successful refresh returns the same saved details, while expiry or revocation removes access. Keyboard Skip to content preserves the token fragment.

## API and access

New `booking-share` Function uses existing exact environment/origin/Test gateway guards. Every management request validates a live customer-capable Auth session, then SQL resolves the canonical account and indexed booking ownership. Guests can manage a newly created guest booking from its original unexpired sealed receipt, under the existing one-hour receipt deadline; matching email alone never proves ownership. Signed-in owners manage through their account afterwards. Neither guest contact is asserted verified.

- POST `create`, `bookingId`, optional private `receipt` → `{url, expiresAt}`.
- POST `revoke`, `bookingId`, optional private `receipt` → `{sharing:false}`.
- POST `view`, `token` → `{booking:<whitelisted immutable appointment snapshot>}`. `sharedAt` is the server capture timestamp; older clients may ignore this additive field. No account is required to view; hosted Test still requires its existing environment access gate.
- All endpoint responses are no-store/no-referrer/noindex. Invalid, revoked, reassigned and expired links return the same LINK_UNAVAILABLE response. No mutation is possible with a viewing link.

`/booking/share#<64 hex token>` keeps the token out of HTTP page URLs, referrers and chat-preview requests. Tokens derive from a random link UUID/nonce under a separate HMAC namespace; only its SHA-256 hash and nonce are saved in the private RLS version table. Exact indexed hash lookup is service-only. A server credential rotation changes the reconstruction key. Existing public tokens still require explicit revocation or expiry; operators must reconcile and rotate link rows during that maintenance. Never expose a server key to restore a link.

Only the owner-authorized RPC response permits reconstructing an existing active URL. User-supplied identity fields are discarded by the Function. No receipt, bearer, contacts or token is logged by the feature or embedded in previews. Do not introduce analytics or third-party scripts on this route.

Each version expires 24 hours after its captured appointment end in Kuwait time. Rescheduling, cancellation, service/package/price edits and shop/barber identity edits never change an existing version or extend its expiry. A newly shared version captures those changes with its own URL and expiry. Customer reassignment and guest/account ownership changes still deny old access. Stop sharing revokes every version for the booking; a new share never reactivates a revoked token. Calendar availability uses the captured status; a formerly confirmed snapshot remains confirmed even if the live booking is later cancelled. It is a shared copy, not a live status tracker. Browser screenshots/copies already taken by recipients cannot be revoked.

## Deployment

Initial migration `20261111040859_customer_booking_share_links.sql`, followed by additive `20261111102111_booking_share_snapshots.sql`; no existing account/history dispatchers or notification runtime settings are replaced. Service-only `public.customer_booking_share` now reads `private.customer_booking_share_versions`, indexed by token hash and booking/version. The original `customer_booking_shares` table is retained unchanged for release recovery, not read by current sharing APIs. Rows reject updates to snapshot/identity/token/expiry fields, and revoked versions cannot be restored. A booking lock serializes concurrent create/revoke requests; repeated unchanged creates reuse one version. `supabase/schema.expected.sql` tracks the new public routine.

Deploy the new Function, preserve its own origin/owner/capability authentication (`verify_jwt=false`), then the hosted Worker allowlist/UI. Preserve Worker secret bindings. A second generic HTML entry has only public brand metadata; production Nginx routing/noindex/no-store/no-referrer support is prepared in source, not deployed to production. Hosting Test remains gated; chat unfurlers without gate credentials will not display its preview. Messaging apps control their own preview caching.

## Legacy links and native compatibility

The snapshot upgrade copies existing link IDs/nonces/hashes/revocation flags without changing their public URLs. Their details are frozen at upgrade time, since earlier live versions were not retained. This is explicit legacy behavior, not a claim to reconstruct the original share date. All seven hosted Test legacy rows were preserved and verified.

The Function request/response contract and token format stay compatible with the existing website and native Test clients. Native share sheets must call create each time they open, use the returned URL and expiresAt, and never build a snapshot from client data or derive a replacement expiry. An already open sheet holds the chosen immutable version. Stop sharing acts on all versions. Preserve the fragment in native URL sharing and keep bearer/receipt/contact details out of URLs, previews and logs. The iOS chat owns its native compatibility tests and documentation; main/Live remain unchanged.

Do not roll the RPC back to the legacy live-reader implementation: that would change privacy/revocation semantics and lose access to newly minted versions. Frontend-only rollback remains compatible with this additive API. Retain both tables until an independently reviewed retention/cleanup release. Uploaded image URLs are captured, but deleted external/storage images may fall back to the existing placeholder; this change does not archive image bytes.

## Related claim-path fix found during acceptance

The actual service-role guest-to-account claim failed on hosted Test because its invoker routine directly read Auth users, a permission not granted to that role. Forward migration `20261111042039_guest_email_claim_permission.sql` keeps the public routine invoker/service-only and moves only the already receipt-bound, verified-email equality to a private boolean security-definer helper with an empty search path and no client grants. It does not grant Auth-table access or turn an email into ownership proof. The existing live-session, sealed-receipt, exact-booking and account checks remain. A real synthetic API claim must pass as part of acceptance.
