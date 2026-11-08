# Manager shop setup

Hosted Test provides **Shop setup** from the manager sidebar, dashboard and shop
page. New managers enter through **Create first shop**. The five views are shop
and opening hours, services, team, approvals and review. My Chair remains optional
and keeps the existing one-chair-per-manager limit.

Completed progress comes from existing saved records rather than a duplicate
onboarding table or a client-controlled completion flag. A fresh visit resumes
the first unmet requirement. Phone, logo and map link remain optional for shops.
Pending invitations do not count as accepted barbers. A ready barber must be the
same active, accepted identity with a shop service and approved working hours that
overlap shop hours. An archived service or inactive barber no longer counts.

The wizard reuses the shared shop, service and invitation forms and audited save
operations. Service and team lists paginate. Hours, breaks and vacations keep
the dedicated per-item manager approval flow. Setup links carry only an owned
shop ID and a fixed internal step; they return to that shop after editing or
approval. Data loads fail visibly and do not create empty records or mark setup
complete. Queries retain current RLS, with an additional live owner check before
loading a shop's service and barber details.

The review step and shop details now include explicit Publish/Pause controls.
New shops start as drafts. Publishing checks saved location, active services and
an accepted active barber with approved hours long enough for a service. The
server rechecks ownership, live session and readiness; changing browser values
cannot skip those checks. Existing shops retain their prior visibility.

Pausing hides the shop from the customer catalog and rejects new public and
manual reservations. Existing appointments remain saved and staff can manage
them. In Admin > Managers > manager details, the admin can allow or disable manual
bookings for a paused shop; public booking stays off. Republishing clears that
exception. Admin suspension remains separate from publishing. This does not add
paid subscriptions or change their future billing policy.

Publishing and permission changes are audited. The Test-only release includes
versioned migrations and the customer-booking catalog Function. Main, dev,
production, iOS and the protected admin remain unchanged until approval.
