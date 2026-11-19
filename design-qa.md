# Subscription Billing preview — design QA

Review date: 19 November 2026 (Asia/Kuwait).
Scope: phase 1 manager Billing design preview, not production billing readiness.
Hosted implementation: https://barber-test.alabdullah-cs.workers.dev/design/billing
Deployed application source: `2aeeec8` on `codex/subscription-billing-preview`.
Cloudflare deployment: `2c3689769d4e4193bba4f2035713ed2f`.

## Visual truth and capture normalization

Source visual truth: `.cloud-test/billing-preview/reference.png`, copied from the
first displayed Product Design result selected by the owner. Original generated
file: `exec-09b65796-65f1-4267-8f46-457d674d9d29.png`.

- Source: 1487 × 1058 pixels.
- Desktop implementation: `.cloud-test/billing-preview/desktop-light.png`,
  1440 × 1024 pixels at 1440 × 1024 CSS px, density 1.
- Source normalized to that desktop frame; no browser/device chrome is included.
- Compared state: English/light, active monthly subscription, six synthetic
  active barbers, usage collapsed, no dialog or scheduled change visible.
- Full-view combined input: `.cloud-test/billing-preview/comparison-final.png`.
- Combined focused price/renewal/usage comparison:
  `.cloud-test/billing-preview/comparison-focus.png`.

Both combined comparison inputs were opened and inspected. A premature screenshot
immediately after resizing had stale dimensions and was rejected, not used as
acceptance evidence. The final screenshot dimensions were checked explicitly.

## Comparison history

First comparison (`comparison-before.png`) identified and blocked on P2 findings:

1. A dark document ancestor incorrectly styled Paid badges inside a light preview.
   Scoped dark selectors to the preview's own theme. Final light/dark captures
   show appropriate readable badges independently of account theme.
2. Invoice rows were approximately 69px because button height and cell padding
   stacked. Reduced cell padding, retaining usable icon buttons and approximately
   56px desktop rows. Final table density follows the reference.
3. Price/display typography was too narrow and row copy too small. Used a
   Georgia display face matching the selected visual geometry, with the existing
   Outfit body font and larger table/detail copy. The final combined full and
   focused captures retain the reference hierarchy and alignment.
4. Close and Notifications inherited missing translation keys. Added localized
   preview labels and focus restoration on dialog-stage changes. Final browser
   snapshots show Close/إغلاق rather than raw keys.

Narrow-screen follow-up identified P2 price clipping at 320 CSS px. Changed the
mobile amount to a responsive clamp. Also made workspace content inert while the
mobile menu is open. Post-fix evidence: `mobile-320-final.png`, with preview
clientWidth and scrollWidth both 316px (320px frame minus scrollbar). Mobile
navigation's final accessibility snapshot contains only navigation controls while
open; Escape closes it and restores access to the main screen.

## Required fidelity surfaces

- Fonts/typography: serif page/section/amount hierarchy and existing Outfit body
  match the selected direction. Amount weight is slightly stronger than the
  generated reference (P3, acceptable for preview review). Arabic is readable,
  RTL, and avoids forcing Latin display faces on Arabic headings.
- Spacing/layout rhythm: flat page, existing app rail/topbar proportions,
  separated summary/usage/invoice rows and one primary action. No nested cards
  or invented feature inventory. Invoices remain readable on small screens.
- Colors/tokens: established warm cream/charcoal/gold tokens; dark mode uses
  #141414 and readable semantic colors. No gradients or extra palette added.
- Assets/image quality: approved production BrandLogo is reused, with explicit
  theme tone; existing lucide-react icons follow the app. No logo drawings,
  placeholder photography or custom icon substitutes.
- Copy/content: six active barbers, KD60.000/month, KD600.000/year and KD120.000
  yearly saving. Next renewal remains 1 December 2026. Sample-data disclosure,
  sample invoice labeling and preview-only confirmation are intentional additions.
  Static shop identity is intentional for this one-shop design, not a live shop
  switcher. The decorative reference badge/count and sidebar diamond are omitted.

## Hosted interaction checks

| Scenario | Observed result |
| --- | --- |
| Initial view | Monthly KD60.000, six active barbers, three sample invoices |
| Expand usage | Six invited/managed/My Chair entries; collapse works |
| Unchanged frequency | Review action disabled |
| Select yearly | KD600.000/year and KD120.000 saving |
| Review yearly change | Effective 1 December; current paid month preserved |
| Confirm preview / undo | Scheduled summary appears; undo restores monthly |
| Cancel renewal | Explicit confirmation; access remains through 1 December |
| Resume renewal | Renewal restored inside preview only |
| Invoice | Explicit sample, correct period/amount, text sample downloads |
| Reload | Preview subscription changes reset |
| Desktop / mobile | Checked 1440×1024, 390×844 and 320×740 |
| Arabic / dark / light | RTL headings, amounts, dates, controls and dialogs checked |
| Mobile menu / Escape | Background inert, focus constrained; Escape closes |
| Dialog transitions | Focus moves to localized Close control |
| Console | Zero error entries in the preview tab |

Additional captures: `desktop-dark.png`, `mobile-dark.png`, `mobile-ar-dark.png`,
`mobile-ar-light.png`, `mobile-yearly-dialog.png` in the same evidence directory.
The temporary viewport override was reset; the Test preview is kept open.

## Regression verification and limits

Lint, frontend build, migration-name and domain checks pass. Existing regression
checks pass: 301 Deno tests, 471 Vitest tests, 80 operations tests, 8 cloud-gateway
unit tests. Initial operations tests were blocked by sandbox socket permissions;
the authorized rerun passed without starting a local website or database.

The installed Node is 24.9.0, below package.json's 24.20.0 minimum; npm emitted
engine warnings. This is a tooling follow-up before any release, not evidence of
production-runtime compatibility. This preview does not require a production
release. Existing unrelated Vite chunk-size/re-export warnings remain.

No billing API, database migration, account change, gateway, real invoice, email,
renewal worker or production enforcement is implemented. Admin/calculator screens
and backend lifecycle tests are next phases, not covered by this acceptance.

## Follow-up polish

- P3: fine-tune amount weight if the owner wants the exact lighter mock appearance.
- Keep future invoices/exports separate from these non-accounting samples.

No actionable P0/P1/P2 visual issues remain within this design-preview scope.

final result: passed
