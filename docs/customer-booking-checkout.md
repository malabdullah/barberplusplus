# Customer booking checkout

Implemented for hosted Test only. Production release requires owner acceptance.

Unsigned-in customers choose **Sign in** or **Continue as guest** after selecting
city, shop, barber, services, date and time. Signed-in customers use their saved
canonical contact. Authentication never confirms an appointment automatically.
The server rechecks availability, duration and price when booking. After login,
the browser also reloads the catalog/slots; a taken time returns to date/time
without discarding the remaining choices or notes.

A one-hour same-origin browser draft retains selection, guest details and notes.
Persistent browser storage supports email callbacks in another tab; tab storage
is the fallback. Different browsers/devices, cleared/disabled storage and expired
drafts cannot resume. No passwords, OTPs, auth sessions or booking verification
proofs are placed in the draft or navigation URL. The explicit return destination
is restricted to `/book` or `/customer/account`. Existing email, Google and Apple
sign-in screens are reused. Provider cancellation can return to the draft.

Guest contact reuse does not imply account appointment ownership and does not
change the existing contact. A successful guest booking returns a dedicated
HMAC-signed `claimToken` valid for one hour. This private receipt capability is
kept with the receipt in browser storage, never in a URL. The success screen offers
**Sign in to save this appointment**, then **Save to my account**. Saving requires
that proof, a live customer session, matching country code/phone, and a matching
canonical customer reference in the database. It attaches only that booking,
is idempotent, and never imports other phone-matched history or overwrites the
profile. A missing/different profile phone requires the customer to correct their
own profile or sign in to the matching account. A failed save leaves the confirmed
appointment intact. Book another appointment explicitly clears the previous draft
and receipt.

`customer-booking` adds `claim-booking`; normal `book` returns optional camelCase
`claimToken` for guest bookings. Existing receipt fields and account API IDs stay
compatible. `public.customer_claim_booking` is an invoker routine executable only
by `service_role`; it delegates to the existing live-session/canonical ownership
checks. The Edge Function verifies the receipt before calling that routine.

## Pending production handoff

Owner instruction: keep main and production unchanged until the owner tests and
approves. Do not notify the iOS agent as if this were live before then.

After an approved production release, verify the migration, changed Function and
frontend together, then notify the **Create iOS customer booking app** chat:
`thread://01a1963b-130e-76c3-9d8e-ba685a06f65a?hostId=local`.
Read that chat before sending the handoff. Share the final commit, API contract,
receipt expiry and ownership checks, preserve-on-sign-in behavior, final explicit
confirmation, and guest receipt save UX. Record the sent handoff here.

Handoff status: **pending owner acceptance and production publication**.

## Repeat hosted verification

Run `npm run test:cloud-checkout` for synthetic API ownership checks followed by
mobile browser checkout tests. Use `CLOUD_TEST_BROWSER=webkit` for WebKit.
The command creates two dedicated confirmed Test customers and Test appointments,
records their IDs privately in `.cloud-test/`, and never signs in as the admin.
Cancel only the recorded synthetic appointments after verification if they are
no longer needed. Fixtures require the Kuwait Test catalog. Email remains in
the private Test inbox. Browser traces and videos stay disabled.
