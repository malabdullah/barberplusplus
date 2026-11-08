# Barber booking confirmation

Each barber chooses whether new customer bookings are confirmed automatically.
The switch is on by default, including existing barbers. Managers using My Chair
have the same preference for their own chair. Other shop managers can confirm
pending appointments but cannot change another barber's personal preference.

Off creates a pending booking that reserves the complete service duration. It
uses the same proof, ownership, service validation, policies, locking and retry
identity as automatic booking. Existing pending/confirmed appointments retain
their status when the preference changes. Manual staff bookings and rescheduling
existing appointments retain their established behavior. No automatic expiry is
introduced; unresolved requests remain pending, including in appointment history.

Customers see the confirmation requirement before submission and an awaiting
confirmation receipt afterward. Their account lists the actual status. Calendar
exports mark pending appointments tentative. Existing dashboard notifications and
Realtime booking updates continue to deliver status changes.

The barber dashboard's pending action confirms instead of completing. Confirmation
locks and checks the current pending row; a stale action cannot revive a resolved
request. Managers can confirm through their booking controls. Declining uses the
existing cancellation action, reason requirement and shop staff permissions; this
feature does not grant a barber a cancellation permission their shop disabled.

Only a live authorized staff session can change a preference or confirm a pending
request. Database guards also protect preference changes made outside the UI.
The old administrator auto-confirm display is not a new global override.

This feature is deployed to hosted Test for owner acceptance before production.
