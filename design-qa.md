# Guest booking visual acceptance

final result: blocked

Source visual truth: the user-approved mobile Guided Finder mock from this chat
(image `exec-3419e58c-b973-45bc-937b-659ae0ec8c47.png`, 853 x 1844 pixels).
The user subsequently approved three screens and shop terminology, superseding
the original six-step labels while retaining its white/charcoal/amber design.

Implementation: `/book` in local Test. Target mobile viewport: 390 x 844 CSS
pixels; also check desktop and Arabic RTL. Implementation screenshot and pixel
density: unavailable. Full-view and focused comparisons remain blocked because
the browser runtime reports local browser use disabled, including after the user
confirmed both plugin and site permissions. No visual pass is claimed.

Required surfaces awaiting browser comparison: font families/weights/wrapping,
spacing and collapsed sections, color/focus/selection contrast, raster shop logo
sizing/quality, English/Arabic copy, narrow layouts and fixed mobile actions.
The Test banner, current fixtures, three-screen structure and shop wording are
intentional differences from the earlier mock.

Functional evidence is recorded in `docs/customer-booking-test.md`. The guest
journey, dependent selections, validation, inline confirmation, conflict recovery
and idempotent retry pass their automated checks. Customer account creation and
its related UI/session/database code are excluded from this dev change.

Remaining acceptance: capture matching mobile/desktop states, compare the source
and implementation together, test the rendered journey and keyboard behavior,
check console errors and Arabic, then fix and recapture any visual issues.
