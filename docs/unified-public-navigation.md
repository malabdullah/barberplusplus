# Unified public navigation

The public website shares one header and footer across the homepage, booking,
customer accounts, customer sign-in and recovery, shop-team sign-in and recovery,
shop registration, invitations, MFA setup and privacy pages.

- Desktop offers Book appointment and Customer sign in directly, plus one Shops
  dropdown containing Team sign in and Register your shop. The logo returns home.
- Mobile shows Customers and Shops groups with their links immediately available,
  without nested dropdowns. The public header uses the existing B++ symbol alone
  at 600px and below, while larger headers retain the full wordmark.
- Signed-in customers see My account and My appointments; staff see Open workspace
  under Shops. Both destinations remain available with independent sessions.
- Staff can visit the homepage without being redirected to their workspace.
  Every workspace toolbar includes a website shortcut; desktop also links to
  customer booking. Role-specific navigation and authorization stay in place.
- Booking entry links retain the supported `/book` return destination through
  customer sign-in and sign-up. The existing booking draft and OAuth callback
  validation remain responsible for restoring the appointment.
- Navigation and preferences wait while a customer request is saving. The mobile
  menu is an in-flow disclosure, with Escape returning focus to its button.
- English and Arabic use the same navigation, with RTL layout and LTR brand art.
  Customer surfaces follow the selected light or dark theme.
- Public footer links point to implemented pages and shop information anchors.

This change is released to hosted Cloud Test first. Advancing `dev` does not
approve or trigger a production release; `main` remains the production boundary.
See [Cloud Test](cloud-test.md) for deployment and private verification setup.
