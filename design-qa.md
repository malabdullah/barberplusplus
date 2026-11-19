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

Previous Billing acceptance: passed


# Calculator and Admin expansion — 19 November 2026

Scope: interactive Test-only design previews using synthetic, in-memory data.
Application source: `ffeff960b25352b18c3f737d9e64ab54ea169f27`.
Cloudflare deployment: `a172c19512844c338690fb8fa63a5d83`.
Routes: `/design/calculator`, `/design/subscriptions`,
`/design/subscriptions/atlas`, `/design/discounts` on hosted Test.

## Visual evidence

The style truth for this expansion is the owner-approved rendered Billing screen,
`.cloud-test/billing-preview/approved-billing-reference.png` (1440 × 1024).
The original generated option remains `reference.png` (1487 × 1058).
This is an adaptation of the approved design system to new tasks, not a
pixel-identical reproduction of the Billing information architecture.

Implementation captures: `calculator-desktop.png`,
`calculator-yearly-desktop.png`, `admin-subscriptions-desktop.png`,
`admin-detail-desktop.png`, `admin-codes-desktop.png` in the same directory.
Primary comparisons use 1440 × 1024 CSS px, density 1, English/light, no dialog.
Combined source/implementation inputs `calculator-comparison.png` and
`admin-comparison.png` are 2880 × 1024 and were opened and inspected together.
The source is left, implementation right, with no browser chrome or density
scaling. `admin-style-focus.png` contains focused heading/top-area crops.

Additional inspected evidence: `admin-mobile-ar-dark.png` (390 CSS px, full page),
`codes-mobile-ar-dark.png`, `calculator-mobile-ar-light.png`,
`calculator-320-large.png`, and `admin-access-dark-final.png`.

## Findings and comparison history

- P2, date controls: changing another field reverted edited dates. Replaced stale
  updates with functional state setters and native input handling; two regression
  tests pass. Hosted equal-date validation retains the edited values; the final
  discount flow retains the chosen 31 January 2027 deadline.
- P2, Arabic typography: Latin fallback did not match the app's Arabic system.
  Applied existing Noto Sans Arabic throughout preview headings/body. Final RTL
  mobile capture shows readable Arabic and correctly separated Latin branding.
- P2, dark native date controls: calendar indicators were black on dark input.
  Scoped native `color-scheme` to the preview theme. Post-fix
  `admin-access-dark-final.png` shows white calendar icons and computed dark
  color scheme.
- P2, incomplete transfer state: a business with one manager offered no clear
  reason for disabled transfer. Added the requirement to assign another manager;
  Coast's transfer dialog shows the explanation and disabled Save action.
- Filter/notice follow-up: search/filter changes reset pagination and all notices
  use the selected language. Annual estimates now include the approximate monthly
  equivalent while retaining the upfront yearly total.

No actionable P0/P1/P2 visual findings remain. The final full-view comparisons
retain the approved cream/charcoal/gold palette, flat sections, serif hierarchy,
Outfit body text, existing rail/topbar, fine dividers and compact action styling.

## Required fidelity surfaces

- Typography: approved serif display hierarchy, Outfit body; Noto Sans Arabic
  for RTL. Long prices use responsive sizing, with no clipping at 320 CSS px.
- Layout: existing rail and topbar proportions; calculator inputs and estimate
  in two flat desktop columns; Admin data in a compact table, stacked labeled
  rows on mobile. These structural differences serve the new screens.
- Colors: existing cream, charcoal, gold and semantic badges; dark #141414;
  native date indicators and dialog controls remain visible.
- Assets: existing BrandLogo SVG and lucide icons, no handcrafted replacement
  logo, generated placeholder imagery or additional raster assets.
- Copy: concise action names, clear preview/sample disclosure, localized labels,
  explicit no-payment estimate, reason fields and relevant validation feedback.

## Hosted flow results

| Scenario | Observed result |
| --- | --- |
| Two active barbers | KD25.000 minimum monthly price |
| Six barbers, monthly/yearly | KD60.000 / KD600.000; annual equivalent KD50/month |
| Monthly WELCOME20 | KD48 due, KD60 next renewal |
| Yearly YEAR20 | KD480 due, KD600 next renewal |
| Ineligible/exhausted code, invalid count | Clear error; estimate review disabled |
| Three-payment monthly code | KD48 first and next, KD60 after offer |
| Code deadline/limit, pause | Chosen deadline/limit retained, pause visible in history |
| List search/filter/pagination | Correct rows; empty state and clear filters work |
| Manual access without branch | Rejected with visible error |
| Manual access + removal | Manual-only shown; underlying expired state restored |
| Complimentary access + removal on paid Atlas | Active, KD60 and 1 December preserved |
| Billing-manager transfer | Omar selected; renewal preserved; Nasser sample read-only |
| No second manager | Explanation shown, Save disabled |
| Invalid date interval | Edited dates retained, submission rejected |
| Theme/language | English/Arabic and light/dark checked |
| Mobile/keyboard | 390 and 320 CSS px, no horizontal overflow; menu/Escape checked |
| Console | No errors in final preview tab |

## Regression checks and boundaries

Full repository check passed on `078df06`: 301 Deno, 490 Vitest across 91 files,
80 operations checks, lint, build and migration/domain checks. Subsequent
UI refinements passed lint, all 19 focused tests and the final Cloud Test build.
Eight gateway tests passed. Existing engine warnings remain: Node 24.9.0 is below
the repository's declared 24.20.0 minimum. This is not a production release gate
clearance or exact production-runtime compatibility claim.

The provider holds only sample React state; refresh resets changes. No database,
Auth, payment, invoice, permission, subscription enforcement, email or worker
change. All new routes remain Test-only. Main and production remain unchanged.
The earlier Billing report's statement that calculator/Admin are next is
superseded by this expansion; backend lifecycle implementation is still future.

## Implementation checklist

- Calculator, Admin list/detail and discount-code screens completed on Test.
- Focused unit tests, build and hosted interaction/visual checks passed.
- Owner review pending before any next implementation or release phase.

P3 follow-up: RTL forward-action icon direction can be refined; labels and
navigation work. No P3 polish blocks this preview review.

final result: passed
