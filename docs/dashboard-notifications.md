# Dashboard notifications

Manager and barber notifications are durable database records. No browser push,
email, SMS, or scheduled reminders are enabled by this change.

`private.notify_booking_change` runs after booking writes, in the same transaction.
It sends one personal row per recipient and event, using a database event UUID and
unique `(event_id, recipient_user_id)` index. Failed bookings roll back alerts;
no-op updates and idempotent customer booking retries create no additional event.
New bookings, schedule/service/detail changes, status changes, cancellations and
reassignments cover website and API clients alike. Reassignment includes both
barbers and both shop managers if the shop changes. The actor receives no routine
self alert. Disabled categories stop delivery at the database boundary.

Barber profile, availability/time-off/vacation updates and accepted invitations
also notify the shop manager through a private trigger. Browser-created alerts
have been removed. Trigger helpers have an empty search path, explicit recipients,
and no client/RPC execution grants. Normal users can select only personal records
for their role and update only `is_read` and `read_at`; admin policies remain.
Legacy branch-addressed manager records are assigned to their existing manager.
Unaddressed historical barber broadcasts do not become personal alerts by guess.

The dashboard subscribes to its recipient ID, fetches on subscription/reconnect,
and reconciles after focus/visibility/online events and every 30 seconds while
visible. History and full unread count use identical preference/cutoff filters.
Read operations are idempotent and always reconcile server state. History loads
in batches of 50. New event copy is translated at display time in English/Arabic.
Booking links choose the manager's shop and date before opening the authorized
appointment. Reading another recipient's alert cannot change their state.

Customer and guest bookings use `added_by_type='customer'`. Historical system
entries are relabeled only if a consumed booking-specific challenge proves their
origin, never from a shared contact or account-owner link alone. Staff audit
attribution and Auth users are not rewritten.

Validate with application checks, `supabase/tests/014_dashboard_notifications.sql`,
and the hosted Test manager/barber browser journeys. Production requires owner
acceptance followed by the normal coordinated release; a Test deployment does
not update main or production.
