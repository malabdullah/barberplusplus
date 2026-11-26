> **Versioned feature contract / historical phase record.** The original status,
> approval limits and verification results below belong to their stated phase.
> Read [the current handoff](handoff.md), [product/status inventory](../PRD.md)
> and source matching the target release before using these details. Earlier
> Test-only/pending wording is not today's deployment status or a new execution grant.

# Permanent live booking sharing — Test release

Every booking receives one server-generated 256-bit public identity at creation.
Sharing reads that identity without generating a snapshot or replacing a link.
The URL stays `/booking/share#<64 lowercase hex characters>`; fragment tokens do
not enter HTTP page access logs or referrers. The page reads current booking,
shop and barber details. Booked service/package line snapshots remain legitimate
booking history; they are not duplicated into new sharing snapshots.

The service-only `customer_booking_share` RPC accepts:

- `create`: current live customer ownership/session or original sealed guest
  receipt required; read-only canonical URL lookup, including past bookings.
- `view`: opaque capability only, read-only live public field whitelist. No
  customer contact, notes, account/session IDs or booking management permissions.
- `receipt`: internal service callback after successful normal booking/recovery;
  never accepted by the public Edge handler. Returns the same canonical identity.
- `revoke`: removed capability, returns `PERMANENT_LINK` rather than claiming a
  permanent link was revoked. No sharing-management controls are offered.

New/recovered guest receipts include `shareUrl`. Recovery/retry preserves it;
private guest claim capabilities retain their original one-hour deadline.
Possession of an email/phone alone never authorizes private URL lookup or claim.

Canonical and imported alias stores reference only the booking, not Auth/customer.
Account deletion still anonymizes the customer, removes notes, ratings, favourites,
provider/session/private data, and cancels eligible future bookings by Kuwait
start timestamp. Retained bookings keep their URLs and current status. Actual
booking removal cascades the mappings and returns generic unavailable.

Existing persisted token hashes are retained as minimal aliases. Explicit
revocation wins across old stores; time-expired unrevoked aliases read live data.
Deleted/missing historical mappings cannot be reconstructed. Alias preparation
precedes canonical backfill. Cross-namespace collisions fail closed, protected by
per-hash transactional locks and a canonical hash index. Historical snapshot
storage remains inactive for a separately approved retirement; account deletion
continues removing its PII-bearing rows normally.

## Unchanged submitted iOS 28 compatibility

The `create` HTTP response retains `url` and a Date-decodable `expiresAt`, adding
`permanent: true` and `sharingVersion: 2`. The date
`9999-12-31T23:59:59.000Z` is ONLY a deprecated decoding shim, never an enforced
lifetime or visible expiry in the new web UI. Exact submitted Swift URL and date
decoders are tested against the actual response. Existing `{action: 'view', token}`
requests remain valid. iOS 28 still locally hides its Share button after its old
appointment deadline; no native UI/artifact is changed by this website release.
All future native work is routed through the coordinator.

Main, production and App Store upload/submission remain on hold for owner review.
