> **Historical preparation/evidence — not a current execution instruction.**
> Preserve the original record below. Read [the handoff](handoff.md) and the current PRD,
> runbooks, target identity and approved release receipt before acting. A candidate,
> old approval or preparation checklist does not establish current production state.

# Live booking app links: prepared update

Prepared on verified main `20fa7885a48ce7adf04241da955bb96ea3cf5f9e`.
No marketing page, Android Test Auth/FCM changes, SQL, provider changes or native
upload/submission are part of this patch.

## Frozen public contract

- Helper: `https://barber-open.alabdullah-cs.workers.dev` in the existing owned
  Cloudflare account. Existing Worker inventory confirmed only `barber-open-test`;
  no existing `barber-open` resource is replaced.
- Allowed entry: `/book?shop=<lowercase UUID>` or `/book?barber=<lowercase UUID>`,
  exactly one selector. Unknown/duplicate parameters and other paths fail closed.
- Direct JSON AASA: `/.well-known/apple-app-site-association`, app ID
  `D49RFZQ6BT.com.barberplusplus.customer`, `/book` components only.
- Browser fallback: 307 to fixed `https://www.barberplusplus.com/book` with only
  the validated public selector. GET/HEAD only; no authentication/cookies or
  private shared-booking viewing capability is forwarded.
- No `/booking/share` interception, native ticket viewer or Android Live
  association. The public shared booking page stays on the website.
- Production shop/barber anchors use the distinct helper host. Test retains its
  existing separate helper; other development navigation remains relative.

## Read-only production API verification

Verified against the live `20fa788` runtime on 2026-11-16 using only its public
runtime configuration and customer catalogue endpoints. No account or booking
writes, provider interactions or server access were used.

- Public catalogue returned 2 shops, 7 barbers and 12 services.
- `customer-booking` action `discovery-entry`, with `{ kind, targetId }`, returns
  `{ city, kind, barberId, branchId }` for current public shop/barber selections.
  Shop entry selects its city/shop and proceeds to barbers; barber entry selects
  its current shop/barber and proceeds to services. Services/date/time are fresh.
- `discovery-selection`, with `{ branchId, barberId }`, returns
  `{ barbers, branches, services, maxDuration }`. Returned service `branch_id`
  matched the selected shop; the selected barber's `service_ids` referenced that
  returned catalogue. Do not assume every shop service is assigned to a barber.
- Barber catalogue fields include `id`, `branch_id`, `name`, `name_ar`,
  `avatar_url`, `service_ids`, `max_booking_days`, `rating`.
- Service fields include `id`, `branch_id`, `name`, `name_ar`, `description`,
  `duration`, `price`. Resolve current public data; never reuse old booking
  prices, services or appointment times as a new booking selection.

## Focused validation

- Seven Node helper checks passed (four new Live checks and three existing Test
  checks), including explicit Live/Test selector and fallback parity.
- Four booking-entry unit checks passed, including environment-specific hosts,
  invalid identifiers, current-draft protection and fresh selection behavior.
- Changed-code lint and whitespace checks passed.
- Five actual hosted Test helper checks passed: direct AASA, shop redirect,
  barber redirect, unknown parameter rejection and public-ticket exclusion.
  Redirects were not followed; no Test app/Auth request or fixture write occurred.
- Reuses the accepted Test native handoff contract; no broad native/device matrix
  or actual Live OS-opening pass is claimed by these server checks.

## Delivery and rollback

1. Coordinator reviews the exact feature source and this helper scope.
2. Deploy the new helper through the existing Cloudflare account with
   `wrangler.booking-links-live.jsonc`; verify direct HTTPS AASA and strict
   fallback responses before shipping website anchors or the native update.
3. Use the usual reviewed dev-first/main production workflow for the tiny
   website anchor change. Preserve CI and existing release controller evidence.
   No database/Functions deployment is required by this patch.
4. Coordinator verifies the matching signed Live app association/handler and
   gates Apple upload/submission on the owner's approval.

Old apps and browsers retain the website fallback. Rollback restores the prior
website image/relative anchors; the helper can remain as a safe browser redirect
for already shared public links. No customer data restore is needed.

At preparation time the helper is not yet deployed, no branch is merged and
production is unchanged. Test frontend is frozen for Android acceptance and is
not overwritten as part of this isolated preparation.
