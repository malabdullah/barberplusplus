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

Main, production and App Store submission remain held for owner review.
