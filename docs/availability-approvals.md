# Availability approvals

This feature is deployed to hosted Test only. Signup wording, invitations, the
setup wizard, shop publishing and paid-shop permissions are separate work.

## Workflow

Ordinary barbers submit regular hours, recurring/one-time breaks, vacations and
the booking horizon from Availability. The submission is a pending proposal;
only the existing approved schedule is used for booking. Identical retries reuse
the request. Changed items replace only their own pending requests. Unchanged pending items keep their identifiers. A draft token protects against overwriting a newer submission.

Managers open the dedicated Availability requests page. Pending, Approved and
Declined tabs have shop, barber and request-type filters and server pagination.
Each weekly working schedule (including the booking horizon), each break and
each vacation has its own review page, decision, original requested value,
approved result, note and reviewer timestamp. Addition, modification and removal
all require a separate decision for the affected item. A manager can modify an
item before approving, or decline it with a reason. Other requests are unaffected.

A request stores its approved base value. Approval applies only that item to the
latest approved schedule. Unrelated sibling approvals do not make it stale;
a change to the same approved component does. New ordinary barbers stay hidden
until their working hours are approved, even if a break or vacation is approved
first. Existing combined records remain history. Pending combined requests are
split without changing approved availability or customer bookings, and old links
show the replacement items.

The review lists future and ongoing pending/confirmed appointments that would
fall outside the proposed hours or overlap a break/vacation. Approval stays
blocked until the manager resolves these appointments through normal booking
actions. Resolve appointment opens the selected booking; Return to availability
review leads back to its request. Reload latest rechecks the review. Approval
never cancels, moves or edits an appointment. Lowering the booking horizon does
not invalidate an existing appointment.

Manager edits without a request, including My Chair, count as a direct approval
and use the same conflict checks. Ordinary-staff batch edits are refused while
individual items are pending, both through the RPC and direct table updates. A manager's chair does not require another
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

Use supabase/tests/027_availability_approvals.sql and
supabase/tests/028_granular_availability.sql for transactional authorization,
conflict protection, decision history, new-barber readiness and boundary checks.
Hosted integration checks additionally race real staff bookings against vacation
approval. Frontend tests cover conflict-disabled approval, resolution links and
barber proposal submission without direct approved-schedule writes.

The full local Docker schema replay is not run without owner authorization.
Keep supabase/schema.expected.sql aligned with public columns, RPC ACLs, triggers
and customer booking row locks. Exact production-image replay is required before
this backend change can be promoted to production.
