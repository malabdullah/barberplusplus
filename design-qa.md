# Customer booking design acceptance

final result: blocked

The three-screen implementation and functional checks are ready for local Test
review. The user explicitly approved the revised flow: city and branch together,
barber/services/date/time together, and details/summary/verification together.
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
- Spacing and layout rhythm: mobile step/context/search/logo rows and sticky
  action; desktop sidebar and form width; short screens and keyboard visibility.
- Colors and tokens: white/charcoal/amber design tokens, focus and selection
  contrast, and the Test-only banner.
- Image quality: three generated raster branch logos are installed and inspected
  individually; rendered sizing, sharpness and fallback state remain unverified.
- Copy and content: English/Arabic content is present; rendered line wrapping
  and right-to-left treatment remain unverified.

Expected differences from the source: the mandatory Test banner, additional
pre-existing synthetic branches, actual fixture ordering, and sample logo art.
Do not remove existing Test data to imitate the mock's three-result count.

Functional evidence: seven three-screen journey checks pass in jsdom, covering
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
2. Capture all three approved screens at 390 × 844 and desktop width, and Arabic
   at mobile width. Check a narrow 320-pixel layout and short viewport as well.
3. Combine normalized source and implementation captures in one comparison image,
   including focused logo/typography/selection and footer comparisons.
4. Exercise city change and search/no results on screen 1; barber before services
   and date/time on screen 2; summary edits, invalid details, displayed Test code
   and direct verification/confirmation on screen 3; then calendar export.
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
