# Shared booking navigation — Test contract

Shared public view adds `shopId` and `barberId`: existing public catalog UUIDs,
not customer, Auth, session or booking capability identifiers. Clicking a name
starts a fresh journey, never a mutation/rebooking of the shared appointment.

- `/book?shop=<lowercase public UUID>` selects the current city/shop and opens
  barber choice. No services/package/date/time from the shared booking are copied.
- `/book?barber=<lowercase public UUID>` derives the barber's current shop/city
  from the published catalog and opens services. Its current assignment wins.
- Exactly one supported query key is accepted, without duplicates/additional keys.
- A current validated catalog entry is required before any draft write. Paused,
  unpublished, removed, unready and self-booking selections fail closed.
- An in-progress browser draft requires explicit replacement confirmation. Cancel,
  Escape, malformed/unavailable targets and network errors preserve it. Consent
  clears old receipt/return state and starts with fresh services/package/date/time.
- Catalog validation happens again through the normal checkout and booking path.
  Public links confer no authentication, account claim, management or reservation.

Shared detail refresh runs once each hour. Focus and visibility changes do not
trigger refresh. Manual retry after an error remains available.

## Test app handoff

The separate HTTPS host `barber-open-test.alabdullah-cs.workers.dev` supports only
GET/HEAD `/book` with that exact query contract. Browsers receive a no-store fixed
307 to the existing gated Test `/book`, preserving only the validated selection.
No credentials, cookies, arbitrary next URL, booking capability or customer data
are forwarded. Unknown methods/paths/queries fail closed.

The two public OS association endpoints return JSON directly without an auth gate,
redirect or cookie. They contain only signed/verified Test application identities:

- iOS: `D49RFZQ6BT.com.barberplusplus.customer.test`, verified by coordinator from
  actual Test 0.2.0 (43) signing. Associated paths are restricted to `/book` entries.
- Android: `com.barberplusplus.customer.test`, verified actual Test APK 0.10.0 (10)
  with the single v2 Android Debug signer reported by the coordinator. Certificate
  SHA-256: `2B:7A:E1:06:E0:10:CF:B7:C9:4C:3B:0B:EA:36:20:5F:AB:66:35:BF:92:CF:DE:0A:AA:FB:EB:26:77:84:11:94`.
  This is only the accepted local Test signer, with no Live/Play signing claim.

No Live identity or `/booking/share` path is associated. The shared ticket stays a
website view. The coordinator owns native assignments after current tasks finish;
no native source or artifact is changed by this website task. Existing apps lack
associated-domain/VIEW handlers, so app-installed acceptance requires later native
builds. OS/browser user preferences may choose the browser even with association.
No installed-app sniffing, custom-scheme timer or forced app launch is used.

Sources: [Apple universal-link guidance](https://developer.apple.com/documentation/technotes/tn3155-debugging-universal-links),
[Android verified App Links](https://developer.android.com/training/app-links/verify-applinks).

This feature remains Test-only. Main and website production are held for owner
review. The existing approved iOS 1.0.0 (28) was separately released under direct
owner instruction; neither that release nor this task authorizes a Live rollout of
these new links or a production binary containing this feature.

## Catalog entry API and native error handling

Use the existing gated Test `POST /test-api/customer-booking` endpoint:

```json
{"action":"discovery-entry","kind":"shop","targetId":"<public shop UUID>"}
```

Or use `kind: "barber"` with the public barber UUID. Guest callers need the normal
Test access capability only; signed-in callers supply their existing Bearer session.
The handler derives account/session identity server-side and ignores client identity
fields. Example successful response shape (HTTP 200):

```json
{"kind":"barber","branchId":"<current public shop UUID>","barberId":"<public barber UUID>","city":"<current catalog city>"}
```

Shop responses have `barberId: null`. After confirmation, the existing discovery
search/selection APIs load the current barber list or scoped provider services.
Always revalidate selection through the normal checkout path; no proof, booking,
claim or account save is made by resolving an entry.

- Guest and valid signed-in callers: HTTP 200 for an eligible target. Signed-in
  self-booking targets are excluded by the server.
- Missing/invalid kind or UUID: HTTP 400, `INVALID_REQUEST`.
- Missing, paused, unpublished, unready or excluded barber/shop: HTTP 400,
  `INVALID_SELECTION`. Do not erase a draft or silently substitute a provider.
- Stale/invalid Bearer session rejected during identity lookup: HTTP 401,
  `VERIFICATION_REQUIRED`. Recover the session using the normal account flow.
- If a session expires between identity lookup and database validation, the
  database denial fails closed through the generic HTTP 503, `UNAVAILABLE` path.
- Transport/backend failure: HTTP 503, `UNAVAILABLE`; preserve the old draft and
  offer retry. Wrong gateway/origin is HTTP 403, `FORBIDDEN`; disabled environment
  is HTTP 404, `NOT_AVAILABLE`. These do not authorize a provider fallback.

The web timer has a 3,600,000ms interval from page mount. Returning focus or changing
visibility does not add a request or reset that timer. A suspended browser may delay
a due interval until execution resumes; there is no separate resume/focus fetch,
no missed-interval catch-up loop and no promise of an exact background delivery
time. After the browser runs a due timer, its next scheduled interval continues.
Unit tests check the exact hourly boundary; hosted tests advance a simulated hour
and verify the request count without waiting an actual hour.
