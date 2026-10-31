# Approved logo rollout — 31 October 2026

The approved B-with-++ identity is deployed on
https://barber-test.alabdullah-cs.workers.dev.
Application release: `8baf320a7a3e3d7ffe7f2d709e7bec4233ba956f`.

Production SVG masters, outlined wordmarks, transparent PNG lockups, monochrome
treatments, browser icons and app icons are in
[the asset package](../design%20system/production-logo/README.md).
The design system and `logo-variants.json` inventory are version 1.2.

`BrandLogo` supplies consistent artwork to marketing headers/footer, the landing
preview, staff authentication, all four role sidebars and customer headers.
It retains LTR artwork in Arabic and switches with the application theme.
Customer booking/auth/account headers explicitly use the light treatment on
their independently light surface. The Test banner no longer covers the
marketing header or its mobile menu.

Validation:

- `npm run check`: lint, Functions checks and 74 tests, 67 frontend tests,
  48 operational tests, migration/domain checks and production build passed.
- `npm run test:cloud-gateway`: all three access/isolation tests passed.
- `npm run test:e2e:cloud`: all 16 hosted checks passed, covering desktop/mobile,
  English/Arabic, light/dark, every staff role, guest booking, customer email
  confirmation and the private inbox.
- Additional staff screenshots wait until each sidebar is fully inside the
  viewport, checking the visible logo rather than an in-progress transition.
- Transparent pixels were verified at both apertures and the waist in all four
  symbol treatments. Favicons were inspected at their native resolutions.
- Live runtime identifies only Supabase Test project `qvkucvcjmojjbphlzlks`.
  Anonymous logo asset requests return 401. Existing gateway secrets and
  observability settings were retained.

Screenshots and logs are retained outside Git in `.cloud-test/`; no credentials,
traces, production data or generated account tokens are included in this report.
This rollout updates hosted Test only. Production remains a separate release.
