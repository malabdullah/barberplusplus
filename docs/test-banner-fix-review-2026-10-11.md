# Separate solo-owner code review — Test banner layout

Review performed separately after implementation, not independent human review.
Scope: branch `codex/test-banner-layout`, based on deployed main `b04eacd`.

Confirmed defect TEST-UI-01: ordinary owner browser DOM hit-testing showed the
sticky Test banner intercepting the mobile Navigation button center. The fix
measures actual rendered height before paint and observes changes, including
language wrapping/zoom. Shared topbar, sidebar and fixed branch dropdown use
that offset with a zero fallback outside Test. Cleanup restores the prior root
property. No public API, credential, integration, schema or migration change.

Regression tests render the actual staging-mode banner while fake .invalid API
requests are intercepted and forwarded only to fixed loopback Supabase. The
key is local and browser-safe; no live secrets are used. Fake WebSocket requests
are intercepted and closed. This does not prove live Auth/Realtime behavior.
Tests cover all four roles, English/Arabic, mobile/tablet/desktop tap targets,
drawer-close focus and resized labels. Existing navigation tests cover themes,
focus trapping, Escape/overlay dismissal, breakpoint and overflow.

Validation: `npm run check` passed, including 13 frontend tests; complete local
Chromium suite passed 13 tests; WebKit QA matrix passed eight tests. No local
database reset. Linux CI must pass all five checks, including all three browser
engines, before a proposed merge. Local Firefox's previous launch limitation is
not counted as a pass.

Outcome: suitable for PR/CI, not authorized to merge or deploy. The live candidate
stays frozen and TEST-BOOK-01 remains an independent high acceptance blocker.
The backend risk deadline and production exclusions remain unchanged.
