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

This phase is a guide, not a publishing permission check. **Setup ready** does
not publish or activate a shop, approve availability, assign services, change a
subscription or grant manual-booking permissions. Dedicated publish/pause and
admin booking-permission controls follow in the next phase. Existing shop status
behavior is preserved. There are no migrations, new tables, Functions or secrets.
Main, dev, production, iOS and the protected admin stay unchanged until approval.
