# Account sessions, activity and support

Scope approved 12 November 2026: integrate the selected older work into current
dev, deploy and verify hosted Test only. Main and production are excluded.
Written reviews remain a future release; no review UI or review migration is
included. Existing Test review data and booking-history behaviour are preserved.

Active sessions: every authenticated role can view only its own account's active
sessions and revoke another session after confirmation. Shared customer/work
modes use the same account; legacy customer aliases remain bound to their own
canonical identity. Current-session sign-out uses the normal sign-out control.
Lists use stable keyset pagination, 25 other sessions per request.

Activity: paginated 25-event history, server-scoped by current Auth role. Admin
sees all events, manager sees currently managed shops, barber sees their own
active work records, agent sees their own actions. Personal customer view uses
owned bookings only, including managers/barbers in customer mode. Events cover
booking creation/reschedule/status changes, shop hours, approved barber schedule
changes, and global booking cutoffs. Historical actions before capture was added
cannot be reconstructed. Existing audit/barber log pages are retained.

Contact Support: signed-in users only, all supported roles; email handoff to
support@barberplusplus.com. No message is automatically sent or copied to support.
No customer inbox, new mailbox or ticketing platform is introduced.

History recommendation: replace a lifetime 50-appointment cap with server-side
pagination/date filtering, not an unlimited download. The current hosted Test
history patch and production history implementation are unchanged in this work.
