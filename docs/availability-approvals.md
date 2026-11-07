# Availability approvals

This feature is deployed to hosted Test only. Signup wording, invitations, the
setup wizard, shop publishing and paid-shop permissions are separate work.

## Workflow

Ordinary barbers submit regular hours, recurring/one-time breaks, vacations and
the booking horizon from Availability. The submission is a pending proposal;
only the existing approved schedule is used for booking. Identical retries reuse
the request. A changed proposal supersedes the previous pending request.

Managers open Availability requests for their selected shop, or a notification.
The editor contains the proposal and allows changes. A disclosure shows the
currently approved schedule. Managers can approve, modify and approve, or decline
with a reason. The original proposal and modified approved proposal are retained
separately. A barber receives the decision in dashboard notifications.

The review lists future and ongoing pending/confirmed appointments that would
fall outside the proposed hours or overlap a break/vacation. Approval stays
blocked until the manager resolves these appointments through normal booking
actions. Resolve appointment opens the selected booking; Return to availability
review leads back to its request. Reload latest rechecks the review. Approval
never cancels, moves or edits an appointment. Lowering the booking horizon does
not invalidate an existing appointment.

Manager edits without a request, including My Chair, count as a direct approval
and use the same conflict checks. A manager's chair does not require another
manager to approve it. Existing approved schedules are preserved. Newly added
ordinary barbers start without approved hours and remain unavailable for public
booking until hours have been approved.

## Enforcement

- Proposals and review history live in private.availability_requests. Raw API
  access is revoked. public.barber_availability checks the live role and shop
  ownership for each action. Request and barber identifiers must match.
- Direct authenticated barber schedule writes are denied. Authorized manager
  writes are checked and audited, including older compatible clients.
- Approval locks the barber; new customer and staff bookings hold a shared
  barber lock. A concurrent booking either secures its slot first and blocks
  approval, or sees the newly approved availability and must satisfy it.
- Revisions reject stale approvals/submissions. Replayed decisions are rejected.
- Transfers clear ordinary barber approval and supersede outstanding requests;
  the barber cannot transfer their own record to bypass ownership checks.
- Trusted server imports remain possible. These are privileged operations, not
  client approval routes.

## Validation

Use supabase/tests/027_availability_approvals.sql for transactional authorization,
conflict protection, decision history, new-barber readiness and boundary checks.
Hosted integration checks additionally race real staff bookings against vacation
approval. Frontend tests cover conflict-disabled approval, resolution links and
barber proposal submission without direct approved-schedule writes.

The full local Docker schema replay is not run without owner authorization.
Keep supabase/schema.expected.sql aligned with public columns, RPC ACLs, triggers
and customer booking row locks. Exact production-image replay is required before
this backend change can be promoted to production.
