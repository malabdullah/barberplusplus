# Customer appointment history and rebooking

My account separates upcoming appointments from past appointments. Completed,
cancelled and no-show appointments appear in history, as do appointments whose
scheduled start has passed in Kuwait time. Upcoming visits sort earliest first;
past appointments sort most recent first. The existing account API returns up to
50 appointments and retains its live-session and account ownership checks.

Book again refreshes the public catalog and fills in the original city, shop and
barber by their exact IDs. It opens the existing editable booking flow at services.
Services and appointment times are cleared; current prices, barber assignments
and availability are checked again. An unavailable shop or barber prompts the
customer to choose a replacement. A catalog failure leaves any existing draft
intact. Route state provides the handoff when session storage is unavailable.

The iOS client already uses migration
`20261101111100_customer_booking_repeat_selection`, applied on hosted Test.
This change includes that same source migration so future database replays retain
the owned history IDs. It changes only the two history projections in the private
account routine; it does not grant new access or change roles, sessions or data.
The public schema snapshot is unchanged because the altered routine is private.

All implementation and verification target hosted Test. Main and production
remain unchanged. Rebooking does not place an appointment until the customer
chooses services and a new time and explicitly confirms the booking.
