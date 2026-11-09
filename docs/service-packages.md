# Shop service packages

The initial release targets hosted Test only. Main, production and the native
application remain unchanged until owner review.

Managers use Services → Packages in the selected shop. A package combines 2–10
active services from that shop for one price, no higher than the separate total.
The selected barber must offer every component. One package and optional extra
services form one appointment with that barber; duration includes every service.

Offer dates use Kuwait calendar days, including both start and end. One week
means seven days; one month means a calendar month. New purchases require the
offer to be active today and the appointment to fall within its dates. Scheduled
offers stay hidden until their first day. Pausing or archiving prevents new
purchases without cancelling existing appointments.

Extend changes an existing period’s end date and allows its existing bookings
to move within that extended period. Republish creates another non-overlapping
period. Previous bookings retain their original period and purchased terms.
Editing a package or its services never rewrites an existing booking’s name,
components, price or duration. Customer and staff date changes remain inside the
original offer’s period; failed reschedules preserve the current appointment.

Private tables are `service_packages`, `package_services` and `package_offers`.
Bookings reference an offer and hold an immutable purchase snapshot. Bounded
RPCs verify live sessions and shop ownership; customer catalogue and booking
calls pass through the existing server gateway. Prices, service eligibility,
quote consent, booking policies and schedule conflicts are checked server-side.
Public catalogue responses contain no staff contacts or customer records.

Staff editing supports extras and explicit package removal. Included components
cannot be removed independently while retaining the package discount. Removing
the package switches to individual service prices for the retained selection.
Existing confirmation, cancellation, SMS verification and notification paths
continue to apply.

Database regression coverage is in `supabase/tests/033_service_packages.sql`.
Tests use rolled-back synthetic identities, services and appointments. Hosted
Test additionally retains its independently deployed native recovery
compatibility; this feature’s deployment overlays only package-related Function
changes and does not promote that unrelated compatibility to main.
