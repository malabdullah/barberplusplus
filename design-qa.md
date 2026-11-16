# Shop introduction design QA

final result: passed

## Visual truth and hosted evidence

- Selected visual: first displayed option, `/Users/malabdullah/.codex/generated_images/01a1920e-481a-7a63-a7ca-8c381dab6ecf/exec-28c9675a-8bd3-4da9-8e7f-b357def3f990.png` (941 x 1672).
- Implementation: https://barber-test.alabdullah-cs.workers.dev/for-shops, source `8b758e5697d86b131fdea4b6bdfc558b55eba8ff`, deployment `76b998c4fd544a61aa5698ff29e37414`.
- Desktop: light English, CSS viewport 1440 x 1000. Screenshot 1432 x 2536 after scrollbar handling. Test banner is intentional and excluded from normalized comparison.
- Evidence: `.cloud-test/shops-qa/` in the `shops-introduction-test` worktree contains desktop light/dark, mobile dark, Arabic mobile light/dark and tablet light screenshots.
- `comparison-full.png` pairs source left / implementation right at equal 800px widths, preserving aspect ratio. `comparison-calendar.png` and `comparison-finance.png` pair focused regions. These are nondestructive QA copies, not product assets.

## Findings and fidelity surfaces

No actionable P0/P1/P2 findings remain.

- Typography: existing Outfit, geometric heading hierarchy and readable body copy preserve the selected direction. Arabic uses the established fallback and RTL. No untranslated keys or heading truncation observed.
- Layout: split calendar hero, two team options, three photo rows, dark finance section and three setup steps match the composition. At 390px the calendar intentionally scrolls within its own focusable region; the document does not overflow. At 768px sections stack without clipping.
- Colors: shared gold actions, white light surface and existing #141414 dark surface. Finance remains dark in either theme. Text and controls are visibly legible.
- Assets: actual Barber++ branding, two generated optimized photographs and existing shop interior. All images loaded. Chart uses Recharts. Calendar is readable illustrative UI, not a working customer calendar.
- Content: invited/managed barbers, My chair, services/packages, availability approvals, booking rules, multiple shops, payments/refunds/expenses and Excel reports. Clearly illustrative figures, no payment gateway, profit or growth promises.
- Intentional adaptations: retained functional public header and Test banner, removed pretend calendar navigation controls, used names without invented identity portraits. Manager signup remains before shop setup.

## Interaction and responsive checks

- Home Explore shop features and Shops menu entry lead to /for-shops.
- Arabic mobile menu shows shop features and team sign-in.
- Manager CTA opens existing /signup form; team CTA opens existing /login form. No submissions or sign-ins.
- Direct route and localized document title pass.
- English/Arabic, light/dark, 390/768/1440 CSS widths pass. English/dark preferences restored and temporary viewport override cleared.
- No document horizontal overflow, missing images, finance overflow or console errors. Chart container is nonzero and SVG renders.
- Existing sessions, accounts, bookings, gateway, inbox, native callback, Functions and database preserved.

## Verification history

- Maintained checks passed lint, Functions lint/typechecks and 300 Deno tests. Application checks passed 451/452; remaining assertion expected old one-link Shops menu. Updated that existing assertion for requested feature link; focused rerun passed 14/14. No unrelated application failure remained.
- Operational checks passed 72/72 after permission for ephemeral loopback fixtures; initial sandbox failures were EPERM only. No local website or Docker runtime started.
- Migration naming, environment-domain guard, production bundle and Test manifest build passed.
- Captured browser render was compared with the source in full view and both focused comparison sheets. No P0/P1/P2 visual correction was needed after that comparison.

## Follow-up polish

- P3: light-mode calendar preview logo's auto tone blends its lower half into the dark calendar bar. Explicit dark tone can be applied after the coordinator's frontend freeze is released. Main logo and functional controls unaffected.
- P3: initial Recharts sizing warning before responsive measurement; final dimensions valid and no console error.

Main and production unchanged. Working manager day/week calendar inspected, not modified; adopting this day-column design is a separate change.
