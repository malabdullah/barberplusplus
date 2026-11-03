# Customer favourites

Customers can save a shop location or an individual barber from `/book`.
`/customer/favourites` lists saved barbers first, followed by shops. Each
shortcut validates the current public booking catalog, then starts at barber
selection or services. The customer can edit the city, shop and barber. A moved
barber requires a location review, and inactive favourites can still be removed.

The customer web and native clients can use the same authenticated
`customer-auth` request contract, through their existing environment-specific
customer Auth transport. Send a customer bearer token for these POST actions:

| Action | Additional request fields |
| --- | --- |
| `favourites-list` | None |
| `favourites-save` | `kind`: `shop` or `barber`; `targetId`: catalog UUID |
| `favourites-remove` | `kind`: `shop` or `barber`; `targetId`: catalog UUID |

All three return `{ favourites: [...] }`. Entries include `kind`, `targetId`,
`name`, `nameAr`, `imageUrl`, `shopId`, `shopName`, `shopNameAr`, `city`, `cityAr`,
`available`, and `locationChanged`. Saving and removal are idempotent. IDs from
request bodies never choose the owner. The gateway checks the live customer
session and the private database function resolves the canonical customer ID.
The database has no customer contact snapshots or public favourite table access.

Errors use the existing customer Auth error envelope. Invalid sessions return
`AUTH_REQUIRED`; an inactive target returns `FAVOURITE_UNAVAILABLE`; the
500-item limit returns `FAVOURITES_LIMIT`. Native clients should revalidate a
saved selection against the live catalog before booking, just as the web does.

Web guest saves use a short-lived intent containing only the item type and ID.
The existing sign-in return preserves the booking draft. The intent is consumed
on a successful save and discarded if the customer explicitly goes back.
