# Customer booking design acceptance

final result: blocked

The approved implementation is one booking page with six guided sections:
city, shop, barber, services, date/time, and details/confirmation. Only the active
task is expanded. Completed choices collapse into editable summaries. Shop,
barber and time choices open the next section automatically; services require
Continue to allow multiple choices. There is no separate-screen navigation.
The existing visual reference supplies colors, typography, logo rows and actions;
its original six-step composition has been superseded by this approved journey.
Visual acceptance has not passed: the browser runtime returns
`Local browser use is disabled in Work settings`, including attempts after the
user confirmed that the Browser plugin is enabled and localhost is Always allow. No alternative browser or hidden browser access was
used. A build, HTTP response or jsdom test is not a rendered visual comparison.

Source visual truth:
`/Users/malabdullah/.codex/generated_images/01a18da0-b108-78f0-a7c8-7c5e6c8bf54c/exec-3419e58c-b973-45bc-937b-659ae0ec8c47.png`

The approved mobile source was opened and inspected. It shows Guided Finder,
city already selected, branch search, three logo rows, Seafront selected and a
sticky Continue to barber button. Source pixels: 853 × 1844. Intended comparison
viewport: 390 × 844 CSS pixels. Normalize the source to that CSS size; record the
implementation screenshot density before comparing.

Implementation URL: http://localhost:5173/book

Implementation screenshot: unavailable. Implementation pixel dimensions and
device scale factor: unverified. Full-view and focused comparisons: blocked.
No visual findings or fidelity claims are inferred from source code alone.

Required fidelity surfaces, all awaiting rendered comparison:

- Fonts and typography: Outfit and Noto Sans Arabic, hierarchy, wrapping and
  Arabic glyph fallback.
- Spacing and layout rhythm: mobile section summaries/search/logo rows and sticky
  action; desktop single-column layout and form width; short screens and keyboard visibility.
- Colors: white, charcoal and amber; focus and selection
  contrast, and the Test-only banner.
- Image quality: three generated raster branch logos are installed and inspected
  individually; rendered sizing, sharpness and fallback state remain unverified.
- Copy and content: English/Arabic content is present; rendered line wrapping
  and right-to-left treatment remain unverified.

Expected differences from the source: the mandatory Test banner, additional
pre-existing synthetic branches, actual fixture ordering, and sample logo art.
Do not remove existing Test data to imitate the mock's three-result count.

Earlier functional evidence: the previous three-screen journey checks passed in jsdom, covering
inline verification/confirmation, search and city changes, barber dependency
resets, invalid details/code, idempotent network retry, slot conflict recovery
and Arabic RTL rendering;
the real API/database probe passes concurrent bookings, signed Test verification,
server-calculated totals, idempotency, manager visibility and tenant denial.
The backend probe passed three consecutive concurrent-booking checks after
a bounded transaction-retry fix for an observed deadlock. These checks do not
establish browser appearance, focus placement or console health.

Comparison history: the original six-step implementation and this approved
three-screen revision both lack completed visual comparison because
implementation capture is blocked. No P0/P1/P2 visual issue is claimed fixed or
accepted without evidence.

Remaining acceptance checklist:

1. Connect the user's in-app browser and open the Test URL.
2. Capture the one-page flow with each of its six sections expanded, at 390 × 844
   and desktop width, plus Arabic at mobile width. Check a narrow 320-pixel layout and short viewport as well.
3. Combine normalized source and implementation captures in one comparison image,
   including focused logo/typography/selection and footer comparisons.
4. Exercise city change and search/no results; barber before services; multiple
   services and Continue; date/time, summary edits, invalid details, displayed
   Test code and verification/confirmation; then calendar export. Confirm one
   expanded task and editable completed summaries throughout.
5. Check browser console errors, keyboard focus and sticky actions. Fix and
   recapture any P0/P1/P2 issues, then update this report with evidence.


Customer account extension (30 October 2026): shop terminology replaces customer
branch wording; admin terminology is preserved. Sign-up/sign-in/phone recovery,
reset-password and account/history screens use the existing white/charcoal/amber
system. Functional coverage includes optional email, customer/staff separation,
booking restoration after sign-in, verified-account booking and session revocation.
Browser capture remains unavailable for these screens as well. Check all auth
forms, account editing/history, logged-in and guest booking at desktop and mobile
sizes in both English and Arabic before visual acceptance. No visual pass is
claimed from code, tests or HTTP responses. final result remains blocked.


Earlier guided-section revision (30 October 2026): local Test had exactly two task
sections per screen: city/shop, barber/services, and date-time/details. Completed
sections collapse to editable summaries; multi-select services remain open until
Continue. Twelve booking UI tests and the full `npm run check` pass (38 application
tests). Date edits preserve entered details, and availability failures and taken
times reopen date/time. Customer account behavior is unchanged. This revision
has not been pushed to dev or deployed. Visual capture remains blocked by the
browser runtime; responsive layout, theme appearance and real browser focus
still require rendered checks. final result remains blocked.


One-page revision (30 October 2026): supersedes the earlier separate-screen flow.
Sixteen booking UI tests pass, and the full `npm run check` passes (42 application,
62 Function and 41 operational tests, lint and build). The local route responds
HTTP 200. Customer account functionality is preserved; no backend or database
changes were made, and nothing has been pushed to dev. Browser access was
attempted again and still reports local browser use disabled. No rendered mobile,
desktop, theme or browser-console acceptance is claimed. final result: blocked.


Dev promotion (30 October 2026): guest-only one-page booking pushed to dev at
`c74a849`. Customer account code remains in local Test. The isolated guest
version passes all maintained checks and 15 booking tests; main is unchanged.
Browser visual acceptance is still pending; promotion does not imply a new
rendered comparison or a production release.


Customer email accounts (31 October 2026): name/email/password signup, confirmation
and recovery links through the local mail catcher, isolated customer sessions,
optional profile phone, and phone required at booking are implemented. Browser QA
confirmed signup and email confirmation, sign-in, missing-phone validation, saved
GCC contact details, booking confirmation/history, recovery form, and persistence
after the user reset the password and signed in again. Mobile English rendering
was inspected. Desktop/Arabic visual acceptance and real provider consent remain
pending. Google/Apple buttons remain disabled until Test credentials are configured.
Approved for dev by the user; this does not authorize a production release.
